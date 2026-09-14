param([switch]$Force,[switch]$TestOnly,[switch]$Real)
$ErrorActionPreference='Stop'
$node = Join-Path $PSScriptRoot "runtime\node\node.exe"
if(-not(Test-Path -LiteralPath $node)){throw 'Runtime embarque manquant.'}
if($Real){& $node (Join-Path $PSScriptRoot 'colleague-runner.js') --real}
else {& $node (Join-Path $PSScriptRoot 'colleague-runner.js') --dry-run}
exit $LASTEXITCODE
