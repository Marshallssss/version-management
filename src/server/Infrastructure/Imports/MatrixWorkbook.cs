using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace ConfigHub.Infrastructure.ExcelImport;

public sealed record MatrixComponent(Guid ComponentId, Guid? ParentComponentId, string ComponentName, int SortOrder, bool IsCategory, Guid? VersionId, string? VersionNumber, bool Changed = false, Guid? PreviousVersionId = null, string? PreviousVersionNumber = null, bool VersionAvailable = true);
public sealed record MatrixInputRow(string RowKey, int RowNumber, string RecordDate, string Reason, bool Submit, IReadOnlyDictionary<Guid, string> Values, string? SourceLabel = null);

public static class MatrixWorkbook
{
    public const int MaximumBytes = 10 * 1024 * 1024;
    public const int MaximumRows = 2000;
    private static readonly XNamespace S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

    public static byte[] Create(Guid templateId, string projectName, IReadOnlyList<MatrixComponent> components, string reference)
    {
        var inputs = components.Where(x => !x.IsCategory).ToList();
        if (inputs.Count is 0 or > 496) throw new InvalidOperationException("模板需要 1 至 496 个可登记版本的组件。");
        var byId = components.ToDictionary(x => x.ComponentId);
        MatrixComponent Root(MatrixComponent item) { while (item.ParentComponentId is Guid parent && byId.TryGetValue(parent, out var next)) item = next; return item; }
        string ComponentPath(MatrixComponent item) { var names = new List<string> { item.ComponentName }; while (item.ParentComponentId is Guid parent && byId.TryGetValue(parent, out var next)) { names.Insert(0, next.ComponentName); item = next; } return string.Join(" / ", names); }
        XElement Cell(int column, int row, string value, int style = 0) => new(S + "c", new XAttribute("r", Column(column) + row), new XAttribute("t", "inlineStr"), new XAttribute("s", style), new XElement(S + "is", new XElement(S + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), value)));
        var metadata = new XElement(S + "row", new XAttribute("r", 1), new XAttribute("hidden", 1), Cell(1, 1, $"ConfigHub.Matrix.v2:{templateId:D}"));
        var title = new XElement(S + "row", new XAttribute("r", 2), new XAttribute("ht", 32), new XAttribute("customHeight", 1), Cell(2, 2, $"{projectName} | 测试版本登记 | {reference}", 1));
        var guidance = new XElement(S + "row", new XAttribute("r", 3), new XAttribute("ht", 34), new XAttribute("customHeight", 1), Cell(2, 3, "每列一套版本；空白保持不变。填写版本、日期和说明后自动录入，无需提交标记。", 3));
        var headings = new XElement(S + "row", new XAttribute("r", 4), new XAttribute("ht", 28), new XAttribute("customHeight", 1), Cell(2, 4, "组件", 2), Cell(3, 4, "冻结参考版本", 2));
        var dates = new XElement(S + "row", new XAttribute("r", 5), new XAttribute("ht", 36), new XAttribute("customHeight", 1), Cell(1, 5, "_date"), Cell(2, 5, "记录日期（必填）\nYYYY-MM-DD，例如 2026-09-18", 4));
        var reasons = new XElement(S + "row", new XAttribute("r", 6), new XAttribute("ht", 44), new XAttribute("customHeight", 1), Cell(1, 6, "_reason"), Cell(2, 6, "变更说明（必填）", 4));
        for (var slot = 1; slot <= MaximumRows; slot++)
        {
            metadata.Add(Cell(slot + 3, 1, $"{templateId:N}-{slot:D4}"));
            headings.Add(Cell(slot + 3, 4, $"测试组合 {slot}", 2));
        }
        var rows = new XElement(S + "sheetData", metadata, title, guidance, headings, dates, reasons);
        var merges = new XElement(S + "mergeCells", new XElement(S + "mergeCell", new XAttribute("ref", "B2:J2")), new XElement(S + "mergeCell", new XAttribute("ref", "B3:J3")), new XElement(S + "mergeCell", new XAttribute("ref", "B5:C5")), new XElement(S + "mergeCell", new XAttribute("ref", "B6:C6")));
        var rowNumber = 7;
        foreach (var group in inputs.GroupBy(x => Root(x).ComponentId))
        {
            var root = Root(group.First());
            rows.Add(new XElement(S + "row", new XAttribute("r", rowNumber), new XAttribute("ht", 28), new XAttribute("customHeight", 1), new XAttribute("s", 5), new XAttribute("customFormat", 1), Cell(1, rowNumber, $"_group:{root.ComponentId:D}"), Cell(2, rowNumber, root.ComponentName, 5), Cell(3, rowNumber, "", 5)));
            merges.Add(new XElement(S + "mergeCell", new XAttribute("ref", $"B{rowNumber}:C{rowNumber}")));
            rowNumber++;
            foreach (var component in group)
            {
                rows.Add(new XElement(S + "row", new XAttribute("r", rowNumber), new XAttribute("ht", 28), new XAttribute("customHeight", 1), Cell(1, rowNumber, component.ComponentId.ToString()), Cell(2, rowNumber, ComponentPath(component), 4), Cell(3, rowNumber, component.VersionNumber ?? "尚未指定", 3)));
                rowNumber++;
            }
        }
        var sheet = new XDocument(new XElement(S + "worksheet", new XElement(S + "sheetViews", new XElement(S + "sheetView", new XAttribute("workbookViewId", 0), new XElement(S + "pane", new XAttribute("xSplit", 3), new XAttribute("ySplit", 6), new XAttribute("topLeftCell", "D7"), new XAttribute("activePane", "bottomRight"), new XAttribute("state", "frozen")))),
            new XElement(S + "cols", new XElement(S + "col", new XAttribute("min", 1), new XAttribute("max", 1), new XAttribute("hidden", 1), new XAttribute("width", 3)), new XElement(S + "col", new XAttribute("min", 2), new XAttribute("max", 2), new XAttribute("width", 42), new XAttribute("customWidth", 1)), new XElement(S + "col", new XAttribute("min", 3), new XAttribute("max", 3), new XAttribute("width", 22), new XAttribute("customWidth", 1), new XAttribute("style", 0)), new XElement(S + "col", new XAttribute("min", 4), new XAttribute("max", MaximumRows + 3), new XAttribute("width", 28), new XAttribute("customWidth", 1), new XAttribute("style", 0))), rows, merges,
            new XElement(S + "dataValidations", new XAttribute("count", 1), new XElement(S + "dataValidation", new XAttribute("type", "textLength"), new XAttribute("operator", "equal"), new XAttribute("allowBlank", 1), new XAttribute("showInputMessage", 1), new XAttribute("showErrorMessage", 1), new XAttribute("promptTitle", "记录日期格式"), new XAttribute("prompt", "请按 YYYY-MM-DD 填写，例如 2026-09-18。"), new XAttribute("errorTitle", "日期格式不正确"), new XAttribute("error", "请以文本填写 YYYY-MM-DD，例如 2026-09-18。"), new XAttribute("sqref", $"D5:{Column(MaximumRows + 3)}5"), new XElement(S + "formula1", 10)))));
        return Package(sheet);
    }

    private static byte[] Package(XDocument sheet)
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, true))
        {
            Add(zip, "[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/></Types>");
            Add(zip, "_rels/.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
            Add(zip, "xl/workbook.xml", "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"版本登记\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
            Add(zip, "xl/_rels/workbook.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>");
            Add(zip, "xl/styles.xml", """
                <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                  <fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts>
                  <fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF285BA8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F4FA"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF394D68"/><bgColor indexed="64"/></patternFill></fill></fills>
                  <borders count="2"><border/><border><top style="medium"><color rgb="FF9EADC0"/></top><bottom style="thin"><color rgb="FFD3DCE8"/></bottom></border></borders>
                  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
                  <cellXfs count="6">
                    <xf numFmtId="49" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"><alignment vertical="center" wrapText="1"/></xf>
                    <xf numFmtId="49" fontId="1" fillId="2" borderId="0"><alignment vertical="center"/></xf>
                    <xf numFmtId="49" fontId="1" fillId="2" borderId="0"><alignment wrapText="1" vertical="center"/></xf>
                    <xf numFmtId="49" fontId="0" fillId="3" borderId="0"><alignment wrapText="1" vertical="center"/></xf>
                    <xf numFmtId="49" fontId="0" fillId="0" borderId="0"><alignment wrapText="1" vertical="center"/></xf>
                    <xf numFmtId="49" fontId="1" fillId="4" borderId="1"><alignment vertical="center"/></xf>
                  </cellXfs>
                  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
                </styleSheet>
                """);
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
            _ = Address(address);
            var kind = (string?)cell.Attribute("t"); var value = cell.Element(S + "v")?.Value ?? "";
            var text = kind switch { "inlineStr" => string.Concat(cell.Descendants(S + "t").Select(x => x.Value)), "s" => int.TryParse(value, out var index) && index >= 0 && index < shared.Length ? shared[index] : throw new InvalidDataException("Excel 文本索引不合法。"), "e" => throw new InvalidDataException($"{address} 含 Excel 错误值。"), _ => value };
            if (!cells.TryAdd(address, (text.Trim(), kind is null or "n" && value.Length > 0))) throw new InvalidDataException("Excel 包含重复单元格。");
        }
        string Value(int c, int r) => cells.GetValueOrDefault(Column(c) + r).Text ?? "";
        if (Value(1, 1) == $"ConfigHub.Matrix.v2:{templateId:D}") return ReadVertical(cells, templateId, components);
        if (Value(1, 1) != $"ConfigHub.Matrix.v1:{templateId:D}") throw new InvalidDataException("Excel 不属于当前项目所选模板，请切换到原项目及对应模板，或重新下载当前项目模板。");
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
            result.Add(new(key, row, Value(fields["_date"], row), Value(fields["_reason"], row), submit == "可导入", values, $"第 {row} 行"));
        }
        return result;
    }

    private static List<MatrixInputRow> ReadVertical(Dictionary<string, (string Text, bool Numeric)> cells, Guid templateId, IReadOnlyList<MatrixComponent> components)
    {
        string Value(int c, int r) => cells.GetValueOrDefault(Column(c) + r).Text ?? "";
        if (Value(1, 5) != "_date" || Value(1, 6) != "_reason") throw new InvalidDataException("模板缺少记录日期或变更说明，请保留完整表头。");
        var expected = components.Where(x => !x.IsCategory).ToDictionary(x => x.ComponentId);
        var bindings = new Dictionary<int, Guid>();
        var groupIds = components.Where(x => x.ParentComponentId is null).Select(x => x.ComponentId).ToHashSet();
        foreach (var cell in cells)
        {
            var (column, row) = Address(cell.Key);
            if (column != 1 || row < 7 || cell.Value.Text.Length == 0) continue;
            if (cell.Value.Text.StartsWith("_group:", StringComparison.Ordinal) && Guid.TryParse(cell.Value.Text.AsSpan(7), out var groupId) && groupIds.Contains(groupId)) continue;
            if (!Guid.TryParse(cell.Value.Text, out var id) || !expected.TryGetValue(id, out var component) || bindings.ContainsValue(id)) throw new InvalidDataException("组件行标识已被修改或重复，请重新生成模板。");
            bindings.Add(row, id);
            if (Value(3, row) != (component.VersionNumber ?? "尚未指定")) throw new InvalidDataException("冻结参考版本不允许修改，请只填写 D 列起的登记内容。");
        }
        if (bindings.Count != expected.Count) throw new InvalidDataException("模板缺少组件行，请保留完整组件表头。");
        var populated = new SortedSet<int>();
        foreach (var cell in cells)
        {
            var (column, row) = Address(cell.Key);
            if (column < 4 || row < 5 || cell.Value.Text.Length == 0) continue;
            if (column > MaximumRows + 3) throw new InvalidDataException("每份模板最多 2000 套测试组合，请生成新模板继续登记。");
            if (row is not (5 or 6) && !bindings.ContainsKey(row)) throw new InvalidDataException($"{cell.Key} 不属于模板组件行，请勿在分类标题行或新增行填写版本；新增组件后重新生成模板。");
            populated.Add(column);
        }
        var result = new List<MatrixInputRow>();
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var column in populated)
        {
            var label = $"{Column(column)} 列";
            var key = Value(column, 1);
            if (!key.StartsWith($"{templateId:N}-", StringComparison.Ordinal) || !int.TryParse(key.AsSpan(33), out var slot) || slot < 1 || slot > MaximumRows || key != $"{templateId:N}-{slot:D4}" || !keys.Add(key)) throw new InvalidDataException($"{label} 标识丢失或重复。请使用模板空白列，不要整列复制覆盖隐藏标识。");
            var values = bindings.ToDictionary(x => x.Value, x => Value(column, x.Key));
            if (values.Values.All(string.IsNullOrWhiteSpace)) throw new InvalidDataException($"{label} 已填写日期或说明，但没有版本变更；请填写至少一个组件版本或清空本列。");
            foreach (var pair in bindings)
                if (values[pair.Value].Length > 0 && cells.GetValueOrDefault(Column(column) + pair.Key).Numeric)
                    throw new InvalidDataException($"{label}「{expected[pair.Value].ComponentName}」必须是文本版本号，请避免数字或日期自动转换。");
            var date = Value(column, 5);
            if (cells.GetValueOrDefault(Column(column) + 5).Numeric || !DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) throw new InvalidDataException($"{label} 记录日期须以文本填写 YYYY-MM-DD，例如 2026-09-18。");
            var reason = Value(column, 6);
            if (reason.Length is 0 or > 500) throw new InvalidDataException($"{label} 变更说明必填且不能超过 500 个字符。");
            result.Add(new(key, column, date, reason, true, values, label));
        }
        return result;
    }

    private static (int Column, int Row) Address(string address)
    {
        var split = 0;
        var column = 0;
        while (split < address.Length && char.IsAsciiLetterUpper(address[split]))
        {
            if (split >= 3) throw new InvalidDataException("Excel 单元格位置不合法。");
            column = column * 26 + address[split++] - 'A' + 1;
        }
        if (column is 0 or > 16384 || !int.TryParse(address.AsSpan(split), NumberStyles.None, CultureInfo.InvariantCulture, out var row) || row is < 1 or > 1048576 || address[split] == '0') throw new InvalidDataException("Excel 单元格位置不合法。");
        return (column, row);
    }

    private static XDocument Xml(ZipArchiveEntry entry)
    {
        using var input = entry.Open(); using var reader = XmlReader.Create(input, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 50 * 1024 * 1024 });
        return XDocument.Load(reader);
    }
    private static void Add(ZipArchive zip, string name, string xml) { using var writer = new StreamWriter(zip.CreateEntry(name, CompressionLevel.Optimal).Open(), new UTF8Encoding(false)); writer.Write(xml); }
    private static string Column(int number) { var result = ""; while (number > 0) { number--; result = (char)('A' + number % 26) + result; number /= 26; } return result; }
}
