param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$CellsJson = '{}'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$changes = $CellsJson | ConvertFrom-Json
$mode = if ($changes.PSObject.Properties.Count -gt 0) { [IO.Compression.ZipArchiveMode]::Update } else { [IO.Compression.ZipArchiveMode]::Read }
$archive = [IO.Compression.ZipFile]::Open($Path, $mode)
try {
    $entry = $archive.GetEntry('xl/worksheets/sheet1.xml')
    $reader = [IO.StreamReader]::new($entry.Open())
    try { [xml]$document = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $ns = [Xml.XmlNamespaceManager]::new($document.NameTable)
    $ns.AddNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    foreach ($property in $changes.PSObject.Properties) {
        $reference = $property.Name
        if ($reference -notmatch '^[A-Z]+[1-9][0-9]*$') { throw 'Invalid test cell reference.' }
        $cell = $document.SelectSingleNode("//s:c[@r='$reference']", $ns)
        if ($null -eq $cell) {
            $rowNumber = $reference -replace '[A-Z]', ''
            $row = $document.SelectSingleNode("//s:row[@r='$rowNumber']", $ns)
            if ($null -eq $row) { throw "Fixture row missing: $rowNumber" }
            $cell = $document.CreateElement('c', $ns.LookupNamespace('s'))
            $cell.SetAttribute('r', $reference)
            [void]$row.AppendChild($cell)
        }
        $cell.RemoveAll()
        $cell.SetAttribute('r', $reference)
        if ($property.Value -is [pscustomobject]) {
            $formula = $document.CreateElement('f', $ns.LookupNamespace('s'))
            $formula.InnerText = $property.Value.formula
            [void]$cell.AppendChild($formula)
        } else {
            $cell.SetAttribute('t', 'inlineStr')
            $inline = $document.CreateElement('is', $ns.LookupNamespace('s'))
            $text = $document.CreateElement('t', $ns.LookupNamespace('s'))
            $text.InnerText = [string]$property.Value
            [void]$inline.AppendChild($text)
            [void]$cell.AppendChild($inline)
        }
    }
    if ($mode -eq [IO.Compression.ZipArchiveMode]::Update) {
        $entry.Delete()
        $entry = $archive.CreateEntry('xl/worksheets/sheet1.xml')
        $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
        try { $document.Save($writer) } finally { $writer.Dispose() }
    }
    $cells = @{}
    foreach ($cell in $document.SelectNodes('//s:c', $ns)) {
        if ($cell.r -match '[1-8]$' -and [int]($cell.r -replace '[A-Z]', '') -le 8) {
            $cells[$cell.r] = $cell.InnerText
        }
    }
    $cells | ConvertTo-Json -Compress
} finally { $archive.Dispose() }
