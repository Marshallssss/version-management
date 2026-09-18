param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$CellsJson = '{}',
    [switch]$LegacyLayout
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$changes = $CellsJson | ConvertFrom-Json
$mode = if ($LegacyLayout -or $changes.PSObject.Properties.Count -gt 0) { [IO.Compression.ZipArchiveMode]::Update } else { [IO.Compression.ZipArchiveMode]::Read }
$archive = [IO.Compression.ZipFile]::Open($Path, $mode)
try {
    $entry = $archive.GetEntry('xl/worksheets/sheet1.xml')
    $reader = [IO.StreamReader]::new($entry.Open())
    try { [xml]$document = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $ns = [Xml.XmlNamespaceManager]::new($document.NameTable)
    $ns.AddNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    if ($LegacyLayout) {
        $original = @{}
        foreach ($cell in $document.SelectNodes('//s:c', $ns)) { $original[$cell.r] = $cell.InnerText }
        if ($original.A1 -notmatch '^ConfigHub.Matrix.v2:') { throw 'Legacy fixture conversion requires a v2 workbook.' }
        $templateId = [Guid]($original.A1 -replace '^ConfigHub.Matrix.v2:', '')
        $components = @($document.SelectNodes('//s:c', $ns) | Where-Object { $_.r -match '^A[0-9]+$' -and $_.InnerText -match '^[0-9a-f-]{36}$' })
        [xml]$document = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData /></worksheet>'
        $ns = [Xml.XmlNamespaceManager]::new($document.NameTable)
        $ns.AddNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
        $sheetData = $document.SelectSingleNode('//s:sheetData', $ns)
        function Add-FixtureCell([int]$Column, [int]$RowNumber, [string]$Value) {
            $letters = ''
            while ($Column -gt 0) { $Column--; $letters = [char](65 + $Column % 26) + $letters; $Column = [int][Math]::Floor($Column / 26) }
            $row = $document.SelectSingleNode("//s:row[@r='$RowNumber']", $ns)
            if ($null -eq $row) {
                $row = $document.CreateElement('row', $ns.LookupNamespace('s')); $row.SetAttribute('r', $RowNumber)
                [void]$sheetData.AppendChild($row)
            }
            $cell = $document.CreateElement('c', $ns.LookupNamespace('s')); $cell.SetAttribute('r', "$letters$RowNumber"); $cell.SetAttribute('t', 'inlineStr'); $cell.SetAttribute('s', '0')
            $inline = $document.CreateElement('is', $ns.LookupNamespace('s')); $text = $document.CreateElement('t', $ns.LookupNamespace('s')); $text.InnerText = $Value
            [void]$inline.AppendChild($text); [void]$cell.AppendChild($inline); [void]$row.AppendChild($cell)
        }
        Add-FixtureCell 1 1 "ConfigHub.Matrix.v1:$($templateId.ToString('D'))"
        Add-FixtureCell 2 1 '_date'
        Add-FixtureCell 3 1 '_reason'
        Add-FixtureCell 4 1 '_submit'
        Add-FixtureCell 2 2 'Legacy v1 compatibility fixture'
        Add-FixtureCell 2 4 'Record date'
        Add-FixtureCell 3 4 'Reason'
        Add-FixtureCell 4 4 'Submit'
        for ($i = 0; $i -lt $components.Count; $i++) {
            $originalRow = $components[$i].r -replace '^A', ''
            Add-FixtureCell ($i + 5) 1 $components[$i].InnerText
            Add-FixtureCell ($i + 5) 4 $original["B$originalRow"]
            Add-FixtureCell ($i + 5) 5 $original["C$originalRow"]
        }
        for ($slot = 1; $slot -le 2000; $slot++) {
            Add-FixtureCell 1 ($slot + 5) ($templateId.ToString('N') + '-' + $slot.ToString('D4'))
            Add-FixtureCell 4 ($slot + 5) ([string][char]0x5F85 + [char]0x586B + [char]0x5199)
        }
    }
    foreach ($property in $changes.PSObject.Properties) {
        $reference = $property.Name
        if ($reference -notmatch '^[A-Z]+[1-9][0-9]*$') { throw 'Invalid test cell reference.' }
        $cell = $document.SelectSingleNode("//s:c[@r='$reference']", $ns)
        if ($null -eq $cell) {
            $rowNumber = $reference -replace '[A-Z]', ''
            $row = $document.SelectSingleNode("//s:row[@r='$rowNumber']", $ns)
            if ($null -eq $row) {
                $row = $document.CreateElement('row', $ns.LookupNamespace('s'))
                $row.SetAttribute('r', $rowNumber)
                [void]$document.SelectSingleNode('//s:sheetData', $ns).AppendChild($row)
            }
            $cell = $document.CreateElement('c', $ns.LookupNamespace('s'))
            $cell.SetAttribute('r', $reference)
            [void]$row.AppendChild($cell)
        }
        $style = $cell.GetAttribute('s')
        $cell.RemoveAll()
        $cell.SetAttribute('r', $reference)
        $cell.SetAttribute('s', $(if ($style) { $style } else { '0' }))
        if ($property.Value -is [pscustomobject]) {
            if ($null -ne $property.Value.numeric) {
                $cell.SetAttribute('t', 'n')
                $value = $document.CreateElement('v', $ns.LookupNamespace('s'))
                $value.InnerText = [string]$property.Value.numeric
                [void]$cell.AppendChild($value)
            } else {
                $formula = $document.CreateElement('f', $ns.LookupNamespace('s'))
                $formula.InnerText = $property.Value.formula
                [void]$cell.AppendChild($formula)
            }
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
        $cells[$cell.r] = $cell.InnerText
    }
    $pane = $document.SelectSingleNode('//s:pane', $ns)
    $groups = @($document.SelectNodes('//s:row', $ns) | Where-Object { $_.s -eq '5' } | ForEach-Object { [int]$_.r })
    $cells['__layout'] = @{ freeze = $(if ($pane) { $pane.topLeftCell } else { '' }); groupRows = $groups; format = $document.SelectSingleNode('//s:dataValidation', $ns).prompt }
    $cells | ConvertTo-Json -Depth 4 -Compress
} finally { $archive.Dispose() }
