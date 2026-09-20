using System.Globalization;
using System.Xml.Linq;

namespace ConfigHub.Infrastructure.ExcelImport;

public sealed record MachineInputRow(int RowNumber, string[] Values);

public static class MachineWorkbook
{
    public const int MaximumMachines = 500;
    public static readonly string[] Headers = ["机台序列号（必填）", "机台名称（必填）", "机型", "位置", "负责人", "工艺（非必填）", "配置（非必填）", "状态", "预计恢复时间", "整机阶段", "PM1 阶段", "PM2 阶段", "PM3 阶段", "PM4 阶段", "PM5 阶段", "PM6 阶段", "当前实际基线名称", "配置记录日期", "录入原因（必填）"];
    private static readonly XNamespace S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly string[] Merges = ["A2:S2", "A3:G3", "H3:P3", "Q3:S3", "A4:G4", "H4:I4", "J4:P4", "Q4:S4"];
    private static string Column(int i) => ((char)('A' + i)).ToString();

    public static byte[] Create(Guid projectId, string projectName)
    {
        XElement Cell(int c, int r, string value, int style = 0) => value.Length == 0
            ? new(S + "c", new XAttribute("r", Column(c) + r), new XAttribute("s", style))
            : new(S + "c", new XAttribute("r", Column(c) + r), new XAttribute("t", "inlineStr"), new XAttribute("s", style), new XElement(S + "is", new XElement(S + "t", value)));
        XElement Row(int r, int height, params XElement[] cells) => new(S + "row", new XAttribute("r", r), new XAttribute("ht", height), new XAttribute("customHeight", 1), cells);
        var data = new XElement(S + "sheetData",
            new XElement(S + "row", new XAttribute("r", 1), new XAttribute("hidden", 1), Cell(0, 1, $"ConfigHub.Machines.v1:{projectId:D}")),
            Row(2, 32, Cell(0, 2, $"{projectName} | 批量登记机台", 1)),
            Row(3, 75, Cell(0, 3, "一行一台；从第 6 行填写。序列号不可重复，已有机台不会覆盖。PM 填阶段表示安装，空白表示未安装；整机阶段空白默认 Lab。", 3), Cell(7, 3, "状态：在用 / 短期 CIP / 长期 CIP / 暂未过货 / 已归档。CIP 必填预计恢复时间：YYYY-MM-DD HH:mm，例如 2026-10-01 09:00（北京时间）。", 3), Cell(16, 3, "基线仅填写本项目已发布名称，作为初始实际配置，不设置目标。无法识别时仍导入机台、版本留空。配置记录日期：YYYY-MM-DD，例如 2026-09-20；匹配基线后必填，不代表安装时间。", 3)),
            Row(4, 26, Cell(0, 4, "机台资料", 5), Cell(7, 4, "运行状态", 5), Cell(9, 4, "整机与已安装腔室阶段", 5), Cell(16, 4, "软件配置与来源", 5)),
            Row(5, 36, Headers.Select((header, i) => Cell(i, 5, header, 2)).ToArray()));
        for (var r = 6; r < 56; r++) data.Add(Row(r, 28, Headers.Select((_, c) => Cell(c, r, "", r % 2 == 0 ? 0 : 3)).ToArray()));
        XElement Validation(string range, string values) => new(S + "dataValidation", new XAttribute("type", "list"), new XAttribute("allowBlank", 1), new XAttribute("showErrorMessage", 1), new XAttribute("errorTitle", "请选择列表中的值"), new XAttribute("error", "请使用下拉选项。"), new XAttribute("sqref", range), new XElement(S + "formula1", $"\"{values}\""));
        var cols = new XElement(S + "cols", Headers.Select((_, c) => new XElement(S + "col", new XAttribute("min", c + 1), new XAttribute("max", c + 1), new XAttribute("width", c is 6 or 16 or 18 ? 32 : c == 8 ? 24 : 18), new XAttribute("customWidth", 1), new XAttribute("style", 0))));
        var sheet = new XDocument(new XElement(S + "worksheet",
            new XElement(S + "sheetViews", new XElement(S + "sheetView", new XAttribute("workbookViewId", 0), new XElement(S + "pane", new XAttribute("xSplit", 2), new XAttribute("ySplit", 5), new XAttribute("topLeftCell", "C6"), new XAttribute("activePane", "bottomRight"), new XAttribute("state", "frozen")))), cols, data,
            new XElement(S + "autoFilter", new XAttribute("ref", "A5:S505")),
            new XElement(S + "mergeCells", Merges.Select(range => new XElement(S + "mergeCell", new XAttribute("ref", range)))),
            new XElement(S + "dataValidations", new XAttribute("count", 2), Validation("H6:H505", "在用,短期 CIP,长期 CIP,暂未过货,已归档"), Validation("J6:P505", "Lab,MoveIn,T0,T1,T2,T3,STR,HVM"))));
        return MatrixWorkbook.Package(sheet, "机台登记");
    }

    public static IReadOnlyList<MachineInputRow> Read(byte[] bytes, Guid projectId)
    {
        var cells = MatrixWorkbook.ReadCells(bytes, out _);
        string Value(int c, int r) => cells.GetValueOrDefault(Column(c) + r).Text ?? "";
        if (Value(0, 1) != $"ConfigHub.Machines.v1:{projectId:D}") throw new InvalidDataException("机台模板不属于当前项目，请重新下载当前项目的机台模板。");
        for (var c = 0; c < Headers.Length; c++) if (Value(c, 5) != Headers[c]) throw new InvalidDataException("机台模板表头被修改或移动，请恢复原表头。");
        foreach (var cell in cells.Where(item => item.Value.Text.Length > 0))
        {
            var address = cell.Key;
            var row = int.Parse(new string(address.Where(char.IsDigit).ToArray()), CultureInfo.InvariantCulture);
            if (row >= 6 && (row > MaximumMachines + 5 || address.TakeWhile(char.IsLetter).Count() != 1 || address[0] > 'S')) throw new InvalidDataException("最多导入 500 台机台，请勿在模板字段以外填写内容。");
        }
        var rows = new List<MachineInputRow>();
        for (var r = 6; r <= MaximumMachines + 5; r++)
        {
            var values = Headers.Select((_, c) => Value(c, r)).ToArray();
            if (values.All(string.IsNullOrWhiteSpace)) continue;
            if (cells.GetValueOrDefault("I" + r).Numeric || cells.GetValueOrDefault("R" + r).Numeric) throw new InvalidDataException($"第 {r} 行日期请按模板格式填写文本，不要使用 Excel 数值日期。");
            rows.Add(new(r, values));
        }
        if (rows.Count == 0) throw new InvalidDataException("没有机台资料，请从第 6 行填写后重新上传。");
        return rows;
    }
}
