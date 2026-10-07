using System.Globalization;
using System.IO.Compression;
using System.Xml.Linq;

namespace ConfigHub.Infrastructure.ExcelImport;

public static partial class MatrixWorkbook
{
    public static byte[] CreateWithHistory(Guid templateId, string projectName, IReadOnlyList<MatrixComponent> components, string reference)
    {
        using var input = new MemoryStream(Create(templateId, projectName, components, reference));
        using var zip = new ZipArchive(input, ZipArchiveMode.Read);
        var sheet = Xml(zip.GetEntry("xl/worksheets/sheet1.xml")!);
        foreach (var row in sheet.Descendants(S + "row").Where(x => (int)x.Attribute("r")! >= 7))
        {
            row.SetAttributeValue("r", (int)row.Attribute("r")! + 3);
            foreach (var cell in row.Elements(S + "c"))
            {
                var (col, number) = Address((string)cell.Attribute("r")!);
                cell.SetAttributeValue("r", Column(col) + (number + 3));
            }
        }
        void SetText(string address, string value) => sheet.Descendants(S + "c").Single(x => (string?)x.Attribute("r") == address).Descendants(S + "t").Single().Value = value;
        SetText("A1", $"ConfigHub.Matrix.v3:{templateId:D}");
        SetText("B2", $"{projectName} | 配置记录 | {reference}");
        SetText("B3", "测试：空白沿用。历史基线：全部组件填版本或“当时未配置”，填写名称/发布时间后由管理员确认。北京时间 UTC+08:00。");
        SetText("B5", "记录日期（测试必填）\nYYYY-MM-DD；历史可留空");
        foreach (var cell in sheet.Descendants(S + "row").Single(x => (int)x.Attribute("r")! == 4).Elements(S + "c").Where(x => Address((string)x.Attribute("r")!).Column >= 4))
            cell.Descendants(S + "t").Single().Value = $"配置记录 {Address((string)cell.Attribute("r")!).Column - 3}";
        var data = sheet.Root!.Element(S + "sheetData")!;
        var after = data.Elements(S + "row").Single(x => (int)x.Attribute("r")! == 6);
        foreach (var field in new[] { (7, "_kind", "记录类型（下拉选择）\n留空默认为测试版本"), (8, "_baseline", "基线名称（历史必填）"), (9, "_releasedAt", "发布时间（历史必填，北京时间）\nYYYY-MM-DD HH:mm") })
        {
            XElement Cell(int c, string text) => new(S + "c", new XAttribute("r", Column(c) + field.Item1), new XAttribute("t", "inlineStr"), new XAttribute("s", 4), new XElement(S + "is", new XElement(S + "t", text)));
            var row = new XElement(S + "row", new XAttribute("r", field.Item1), new XAttribute("ht", 38), new XAttribute("customHeight", 1), Cell(1, field.Item2), Cell(2, field.Item3));
            after.AddAfterSelf(row); after = row;
        }
        var merges = sheet.Root.Element(S + "mergeCells")!;
        foreach (var merge in merges.Elements())
        {
            var parts = ((string)merge.Attribute("ref")!).Split(':').Select(Address).ToArray();
            if (parts[0].Row >= 7) merge.SetAttributeValue("ref", string.Join(':', parts.Select(p => Column(p.Column) + (p.Row + 3))));
        }
        foreach (var row in new[] { 7, 8, 9 }) merges.Add(new XElement(S + "mergeCell", new XAttribute("ref", $"B{row}:C{row}")));
        var pane = sheet.Descendants(S + "pane").Single(); pane.SetAttributeValue("ySplit", 9); pane.SetAttributeValue("topLeftCell", "D10");
        var validations = sheet.Root.Element(S + "dataValidations")!; validations.SetAttributeValue("count", 2);
        validations.Add(new XElement(S + "dataValidation", new XAttribute("type", "list"), new XAttribute("allowBlank", 1), new XAttribute("showErrorMessage", 1), new XAttribute("error", "请选择测试版本或历史基线。"), new XAttribute("sqref", $"D7:{Column(MaximumRows + 3)}7"), new XElement(S + "formula1", "\"测试版本,历史基线\"")));
        return Package(sheet, "配置记录");
    }

    private static MatrixInputRow[] ReadHistoricalVertical(Dictionary<string, (string Text, bool Numeric)> cells, Guid templateId, IReadOnlyList<MatrixComponent> components)
    {
        string Value(int c, int r) => cells.GetValueOrDefault(Column(c) + r).Text ?? "";
        if (Value(1, 7) != "_kind" || Value(1, 8) != "_baseline" || Value(1, 9) != "_releasedAt") throw new InvalidDataException("模板缺少记录类型、基线名称或发布时间，请重新下载完整模板。");
        var kinds = new Dictionary<int, (string Kind, string Name, string Released)>();
        var converted = new Dictionary<string, (string Text, bool Numeric)>();
        foreach (var cell in cells)
        {
            var (column, row) = Address(cell.Key);
            if (row is >= 7 and <= 9) continue;
            converted[Column(column) + (row >= 10 ? row - 3 : row)] = cell.Value;
        }
        var columns = cells.Where(x => x.Value.Text.Length > 0).Select(x => Address(x.Key)).Where(x => x.Column >= 4 && x.Row >= 5).Select(x => x.Column).Distinct();
        foreach (var column in columns)
        {
            var kind = Value(column, 7); var name = Value(column, 8); var released = Value(column, 9);
            if (kind is not ("" or "测试版本" or "历史基线")) throw new InvalidDataException($"{Column(column)} 列记录类型只能选择测试版本或历史基线。");
            var historical = kind == "历史基线";
            if (!historical && (name.Length > 0 || released.Length > 0)) throw new InvalidDataException($"{Column(column)} 列填写了历史基线字段，请明确选择历史基线类型。");
            if (historical)
            {
                if (name.Length is 0 or > 100) throw new InvalidDataException($"{Column(column)} 列基线名称必填且最多 100 字。");
                if (cells.GetValueOrDefault(Column(column) + 9).Numeric || !DateTime.TryParseExact(released, "yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) throw new InvalidDataException($"{Column(column)} 列发布时间须以文本填写 YYYY-MM-DD HH:mm（北京时间）。");
                if (Value(column, 5).Length == 0) converted[Column(column) + 5] = (released[..10], false);
            }
            // A partially filled metadata-only column must still be validated by the common parser.
            if (!converted.Any(x => Address(x.Key).Column == column && Address(x.Key).Row >= 5 && x.Value.Text.Length > 0)) converted[Column(column) + 6] = ("待完善", false);
            kinds[column] = (historical ? "HistoricalBaseline" : "Testing", name, released);
        }
        return ReadVertical(converted, templateId, components).Select(row => row with { RecordType = kinds[row.RowNumber].Kind, BaselineName = kinds[row.RowNumber].Name, ReleasedAt = kinds[row.RowNumber].Released }).ToArray();
    }
}
