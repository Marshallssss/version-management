using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace ConfigHub.Infrastructure.ExcelImport;

public sealed record MatrixComponent(Guid ComponentId, Guid? ParentComponentId, string ComponentName, int SortOrder, bool IsCategory, Guid? VersionId, string? VersionNumber, bool Changed = false);
public sealed record MatrixInputRow(string RowKey, int RowNumber, string RecordDate, string Reason, bool Submit, IReadOnlyDictionary<Guid, string> Values);

public static class MatrixWorkbook
{
    public const int MaximumBytes = 10 * 1024 * 1024;
    public const int MaximumRows = 2000;
    private static readonly XNamespace S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

    public static byte[] Create(Guid templateId, string projectName, IReadOnlyList<MatrixComponent> components, string reference)
    {
        var columns = components.Where(x => !x.IsCategory).ToList();
        if (columns.Count is 0 or > 496) throw new InvalidOperationException("模板需要 1 至 496 个可登记版本的组件。");
        var byId = components.ToDictionary(x => x.ComponentId);
        string Root(MatrixComponent item) { while (item.ParentComponentId is Guid parent && byId.TryGetValue(parent, out var next)) item = next; return item.ComponentName; }
        string ComponentPath(MatrixComponent item) { var names = new List<string> { item.ComponentName }; while (item.ParentComponentId is Guid parent && byId.TryGetValue(parent, out var next)) { names.Insert(0, next.ComponentName); item = next; } return string.Join(" / ", names); }
        XElement Cell(int column, int row, string value, int style = 0) => new(S + "c", new XAttribute("r", Column(column) + row), new XAttribute("t", "inlineStr"), new XAttribute("s", style), new XElement(S + "is", new XElement(S + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), value)));
        var metadata = new XElement(S + "row", new XAttribute("r", 1), new XAttribute("hidden", 1), Cell(1, 1, $"ConfigHub.Matrix.v1:{templateId:D}"), Cell(2, 1, "_date"), Cell(3, 1, "_reason"), Cell(4, 1, "_submit"));
        var title = new XElement(S + "row", new XAttribute("r", 2), new XAttribute("ht", 30), new XAttribute("customHeight", 1), Cell(2, 2, $"{projectName} | 测试版本登记 | {reference}", 1));
        var groups = new XElement(S + "row", new XAttribute("r", 3), new XAttribute("ht", 24), new XAttribute("customHeight", 1), Cell(2, 3, "本次变更", 2));
        var headings = new XElement(S + "row", new XAttribute("r", 4), new XAttribute("ht", 36), new XAttribute("customHeight", 1), Cell(2, 4, "记录日期", 2), Cell(3, 4, "变更说明（必填）", 2), Cell(4, 4, "提交标记", 2));
        var baseline = new XElement(S + "row", new XAttribute("r", 5), Cell(2, 5, "冻结参考", 3), Cell(3, 5, "空白继承；新版本仅进入测试中", 3), Cell(4, 5, "只读", 3));
        for (var i = 0; i < columns.Count; i++) { metadata.Add(Cell(i + 5, 1, columns[i].ComponentId.ToString())); groups.Add(Cell(i + 5, 3, Root(columns[i]), 2)); headings.Add(Cell(i + 5, 4, ComponentPath(columns[i]), 2)); baseline.Add(Cell(i + 5, 5, columns[i].VersionNumber ?? "尚未指定", 3)); }
        var rows = new XElement(S + "sheetData", metadata, title, groups, headings, baseline);
        for (var i = 0; i < MaximumRows; i++) rows.Add(new XElement(S + "row", new XAttribute("r", i + 6), Cell(1, i + 6, $"{templateId:N}-{i + 1:D4}"), Cell(4, i + 6, "待填写")));
        var merges = new XElement(S + "mergeCells", new XElement(S + "mergeCell", new XAttribute("ref", $"B2:{Column(columns.Count + 4)}2")), new XElement(S + "mergeCell", new XAttribute("ref", "B3:D3")));
        for (var start = 0; start < columns.Count;) { var end = start; while (end + 1 < columns.Count && Root(columns[end + 1]) == Root(columns[start])) end++; if (end > start) merges.Add(new XElement(S + "mergeCell", new XAttribute("ref", $"{Column(start + 5)}3:{Column(end + 5)}3"))); start = end + 1; }
        var sheet = new XDocument(new XElement(S + "worksheet", new XElement(S + "sheetViews", new XElement(S + "sheetView", new XAttribute("workbookViewId", 0), new XElement(S + "pane", new XAttribute("xSplit", 4), new XAttribute("ySplit", 5), new XAttribute("topLeftCell", "E6"), new XAttribute("activePane", "bottomRight"), new XAttribute("state", "frozen")))),
            new XElement(S + "cols", new XElement(S + "col", new XAttribute("min", 1), new XAttribute("max", 1), new XAttribute("hidden", 1), new XAttribute("width", 3)), new XElement(S + "col", new XAttribute("min", 2), new XAttribute("max", 2), new XAttribute("width", 16), new XAttribute("customWidth", 1), new XAttribute("style", 0)), new XElement(S + "col", new XAttribute("min", 3), new XAttribute("max", 3), new XAttribute("width", 42), new XAttribute("customWidth", 1), new XAttribute("style", 0)), new XElement(S + "col", new XAttribute("min", 4), new XAttribute("max", 4), new XAttribute("width", 16), new XAttribute("customWidth", 1)), new XElement(S + "col", new XAttribute("min", 5), new XAttribute("max", columns.Count + 4), new XAttribute("width", 24), new XAttribute("customWidth", 1), new XAttribute("style", 0))), rows, merges,
            new XElement(S + "dataValidations", new XAttribute("count", 1), new XElement(S + "dataValidation", new XAttribute("type", "list"), new XAttribute("allowBlank", 1), new XAttribute("showErrorMessage", 1), new XAttribute("errorTitle", "选择提交标记"), new XAttribute("error", "请选择待填写或可导入。"), new XAttribute("sqref", $"D6:D{MaximumRows + 5}"), new XElement(S + "formula1", "\"待填写,可导入\"")))));
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, true))
        {
            Add(zip, "[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/></Types>");
            Add(zip, "_rels/.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
            Add(zip, "xl/workbook.xml", "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"版本登记\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
            Add(zip, "xl/_rels/workbook.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>");
            Add(zip, "xl/styles.xml", "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Microsoft YaHei\"/></font><font><b/><sz val=\"11\"/><color rgb=\"FFFFFFFF\"/><name val=\"Microsoft YaHei\"/></font></fonts><fills count=\"4\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill><fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF175E57\"/><bgColor indexed=\"64\"/></patternFill></fill><fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFEAF0EF\"/><bgColor indexed=\"64\"/></patternFill></fill></fills><borders count=\"1\"><border/></borders><cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"4\"><xf numFmtId=\"49\" fontId=\"0\" fillId=\"0\" borderId=\"0\" applyNumberFormat=\"1\"/><xf numFmtId=\"49\" fontId=\"1\" fillId=\"2\" borderId=\"0\"/><xf numFmtId=\"49\" fontId=\"1\" fillId=\"2\" borderId=\"0\"><alignment wrapText=\"1\" vertical=\"center\"/></xf><xf numFmtId=\"49\" fontId=\"0\" fillId=\"3\" borderId=\"0\"/></cellXfs><cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles></styleSheet>");
            Add(zip, "xl/worksheets/sheet1.xml", sheet.ToString(SaveOptions.DisableFormatting));
        }
        return stream.ToArray();
    }

    public static IReadOnlyList<MatrixInputRow> Read(byte[] bytes, Guid templateId, IReadOnlyList<MatrixComponent> components)
    {
        if (bytes.Length > MaximumBytes) throw new InvalidDataException("Excel 不能超过 10 MiB。");
        using var stream = new MemoryStream(bytes); using var zip = new ZipArchive(stream, ZipArchiveMode.Read);
        if (zip.Entries.Count > 200 || zip.Entries.Sum(x => x.Length) > 50 * 1024 * 1024 || zip.Entries.Select(x => x.FullName).Distinct(StringComparer.Ordinal).Count() != zip.Entries.Count)
            throw new InvalidDataException("Excel 内容过大或压缩结构不合法。");
        foreach (var entry in zip.Entries)
        {
            if (entry.FullName.Contains("vbaProject", StringComparison.OrdinalIgnoreCase) || entry.FullName.Contains("externalLinks", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("不支持宏或外部数据链接。");
            if (entry.FullName.EndsWith(".rels", StringComparison.OrdinalIgnoreCase) && Xml(entry).Descendants().Any(x => (string?)x.Attribute("TargetMode") == "External")) throw new InvalidDataException("模板不能包含外部链接。");
        }
        var shared = zip.GetEntry("xl/sharedStrings.xml") is { } strings ? Xml(strings).Descendants(S + "si").Select(x => string.Concat(x.Descendants(S + "t").Select(t => t.Value))).ToArray() : [];
        var doc = Xml(zip.GetEntry("xl/worksheets/sheet1.xml") ?? throw new InvalidDataException("未找到版本登记工作表，请使用本项目生成的模板。"));
        if (doc.Descendants(S + "f").Any()) throw new InvalidDataException("版本登记表不能包含公式，请粘贴为文本值。");
        var cells = new Dictionary<string, (string Text, bool Numeric)>();
        foreach (var cell in doc.Descendants(S + "c"))
        {
            var address = (string?)cell.Attribute("r") ?? throw new InvalidDataException("Excel 单元格缺少位置。");
            var kind = (string?)cell.Attribute("t"); var value = cell.Element(S + "v")?.Value ?? "";
            var text = kind switch { "inlineStr" => string.Concat(cell.Descendants(S + "t").Select(x => x.Value)), "s" => int.TryParse(value, out var index) && index >= 0 && index < shared.Length ? shared[index] : throw new InvalidDataException("Excel 文本索引不合法。"), "e" => throw new InvalidDataException($"{address} 含 Excel 错误值。"), _ => value };
            if (!cells.TryAdd(address, (text.Trim(), kind is null or "n" && value.Length > 0))) throw new InvalidDataException("Excel 包含重复单元格。");
        }
        string Value(int c, int r) => cells.GetValueOrDefault(Column(c) + r).Text ?? "";
        if (Value(1, 1) != $"ConfigHub.Matrix.v1:{templateId:D}") throw new InvalidDataException("Excel 与所选模板不匹配，请选择生成此文件的模板。");
        var expected = components.Where(x => !x.IsCategory).ToDictionary(x => x.ComponentId);
        var bindings = new Dictionary<int, Guid>(); var fields = new Dictionary<string, int>();
        for (var c = 2; c <= 500; c++)
        {
            var value = Value(c, 1); if (value.Length == 0) continue;
            if (value is "_date" or "_reason" or "_submit") { if (!fields.TryAdd(value, c)) throw new InvalidDataException("模板字段重复。"); continue; }
            if (!Guid.TryParse(value, out var id) || !expected.TryGetValue(id, out var expectedComponent) || bindings.ContainsValue(id)) throw new InvalidDataException("组件列标识已被修改或重复，请重新生成模板。");
            bindings.Add(c, id);
            if (Value(c, 5) != (expectedComponent.VersionNumber ?? "尚未指定")) throw new InvalidDataException("冻结参考版本不允许修改，请只填写第 6 行起的登记内容。");
        }
        if (bindings.Count != expected.Count || fields.Count != 3) throw new InvalidDataException("模板缺少组件列或登记字段，请保留完整表头。");
        var permittedColumns = bindings.Keys.Concat(fields.Values).Select(Column).Append("A").ToHashSet(StringComparer.Ordinal);
        foreach (var cell in cells)
        {
            var split = 0;
            while (split < cell.Key.Length && char.IsAsciiLetterUpper(cell.Key[split])) split++;
            if (split == 0 || !int.TryParse(cell.Key.AsSpan(split), out var rowNumber)) throw new InvalidDataException("Excel 单元格位置不合法。");
            if (rowNumber >= 6 && cell.Value.Text.Length > 0 && !permittedColumns.Contains(cell.Key[..split])) throw new InvalidDataException($"{cell.Key} 不属于模板组件列，请勿自行添加组件列；新增组件后重新生成模板。");
        }
        var dataRows = doc.Descendants(S + "row").Select(x => int.TryParse((string?)x.Attribute("r"), out var row) ? row : 0).Where(x => x >= 6).Order().ToArray();
        var result = new List<MatrixInputRow>(); var keys = new HashSet<string>();
        foreach (var row in dataRows)
        {
            var values = bindings.ToDictionary(x => x.Value, x => Value(x.Key, row));
            if (values.Values.All(string.IsNullOrWhiteSpace)) continue;
            if (row > MaximumRows + 5) throw new InvalidDataException("每份模板最多 2000 条记录，请生成新模板继续登记。");
            var key = Value(1, row);
            if (!key.StartsWith($"{templateId:N}-", StringComparison.Ordinal) || !int.TryParse(key.AsSpan(33), out var slot) || slot < 1 || slot > MaximumRows || !keys.Add(key)) throw new InvalidDataException($"第 {row} 行标识丢失或重复。请使用模板空白行，不要整行复制覆盖隐藏标识。");
            foreach (var pair in bindings) if (values[pair.Value].Length > 0 && cells.GetValueOrDefault(Column(pair.Key) + row).Numeric) throw new InvalidDataException($"第 {row} 行「{expected[pair.Value].ComponentName}」必须是文本版本号，请避免数字或日期自动转换。");
            var submit = Value(fields["_submit"], row);
            if (submit is not ("可导入" or "待填写" or "")) throw new InvalidDataException($"第 {row} 行提交标记只能是待填写或可导入。");
            result.Add(new(key, row, Value(fields["_date"], row), Value(fields["_reason"], row), submit == "可导入", values));
        }
        return result;
    }

    private static XDocument Xml(ZipArchiveEntry entry)
    {
        using var input = entry.Open(); using var reader = XmlReader.Create(input, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 50 * 1024 * 1024 });
        return XDocument.Load(reader);
    }
    private static void Add(ZipArchive zip, string name, string xml) { using var writer = new StreamWriter(zip.CreateEntry(name, CompressionLevel.Optimal).Open(), new UTF8Encoding(false)); writer.Write(xml); }
    private static string Column(int number) { var result = ""; while (number > 0) { number--; result = (char)('A' + number % 26) + result; number /= 26; } return result; }
}
