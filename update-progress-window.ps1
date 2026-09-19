param([Parameter(Mandatory=$true)][string]$DoneFile,[Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form=[Windows.Forms.Form]::new()
$form.Text='Assistant Planning - Mise a jour'
$form.ClientSize=[Drawing.Size]::new(640,800)
$form.MinimumSize=[Drawing.Size]::new(656,839)
$form.MaximumSize=[Drawing.Size]::new(656,839)
$form.StartPosition='CenterScreen'
$form.BackColor=[Drawing.Color]::FromArgb(250,250,249)
$form.Font=[Drawing.Font]::new('Segoe UI',11)
$form.ControlBox=$false
$header=[Windows.Forms.Panel]::new();$header.SetBounds(0,0,640,126);$header.BackColor=[Drawing.Color]::White;$form.Controls.Add($header)
$line=[Windows.Forms.Panel]::new();$line.Dock='Bottom';$line.Height=4;$line.BackColor=[Drawing.Color]::FromArgb(232,35,42);$header.Controls.Add($line)
$mark=[Windows.Forms.Label]::new();$mark.Text='AP';$mark.SetBounds(26,18,92,88);$mark.BackColor=[Drawing.Color]::FromArgb(3,46,66);$mark.ForeColor=[Drawing.Color]::White;$mark.Font=[Drawing.Font]::new('Segoe UI',27,[Drawing.FontStyle]::Bold);$mark.TextAlign='MiddleCenter';$header.Controls.Add($mark)
function Add-HeaderLabel($text,$x,$y,$size,$bold,$color){$label=[Windows.Forms.Label]::new();$label.Text=$text;$label.AutoSize=$true;$label.Location=[Drawing.Point]::new($x,$y);$label.Font=[Drawing.Font]::new('Segoe UI',$size, $(if($bold){[Drawing.FontStyle]::Bold}else{[Drawing.FontStyle]::Regular}));$label.ForeColor=$color;$header.Controls.Add($label)}
$blue=[Drawing.Color]::FromArgb(3,46,66);$gray=[Drawing.Color]::FromArgb(94,107,113);$red=[Drawing.Color]::FromArgb(232,35,42)
Add-HeaderLabel 'UDSP 14' 140 22 12 $true $blue
Add-HeaderLabel 'Service Formation' 141 47 10 $false $gray
Add-HeaderLabel 'Assistant Planning' 138 63 25 $true $blue
$heading=[Windows.Forms.Label]::new();$heading.Text='Mise a jour d Assistant Planning';$heading.SetBounds(34,148,570,32);$heading.ForeColor=$blue;$heading.Font=[Drawing.Font]::new('Segoe UI',11,[Drawing.FontStyle]::Bold);$form.Controls.Add($heading)
$panel=[Windows.Forms.Panel]::new();$panel.SetBounds(34,190,570,340);$panel.BackColor=$form.BackColor;$form.Controls.Add($panel)
$spinner=[Windows.Forms.Label]::new();$spinner.SetBounds(235,62,100,70);$spinner.Font=[Drawing.Font]::new('Segoe UI',36);$spinner.ForeColor=$red;$spinner.Text='|';$spinner.TextAlign='MiddleCenter';$panel.Controls.Add($spinner)
$title=[Windows.Forms.Label]::new();$title.Text='Installation en cours - v'+$Version;$title.SetBounds(40,140,490,42);$title.Font=[Drawing.Font]::new('Segoe UI',12,[Drawing.FontStyle]::Bold);$title.ForeColor=$blue;$title.TextAlign='MiddleCenter';$panel.Controls.Add($title)
$detail=[Windows.Forms.Label]::new();$detail.Text='Remplacement des composants de l application';$detail.SetBounds(40,194,490,30);$detail.ForeColor=$gray;$detail.TextAlign='MiddleCenter';$panel.Controls.Add($detail)
$progress=[Windows.Forms.ProgressBar]::new();$progress.SetBounds(70,245,430,18);$progress.Style='Marquee';$progress.MarqueeAnimationSpeed=25;$panel.Controls.Add($progress)
$notice=[Windows.Forms.Label]::new();$notice.Text='Merci de patienter. Ne relancez pas Assistant Planning.';$notice.SetBounds(15,282,540,38);$notice.ForeColor=[Drawing.Color]::FromArgb(120,128,132);$notice.Font=[Drawing.Font]::new('Segoe UI',9);$notice.TextAlign='MiddleCenter';$panel.Controls.Add($notice)
$footer=[Windows.Forms.Label]::new();$footer.Text='L application redemarrera automatiquement a la fin.';$footer.SetBounds(34,612,570,28);$footer.ForeColor=$gray;$footer.TextAlign='MiddleCenter';$form.Controls.Add($footer)
$versionLabel=[Windows.Forms.Label]::new();$versionLabel.Text='Assistant Planning - v'+$Version;$versionLabel.SetBounds(34,760,570,24);$versionLabel.ForeColor=[Drawing.Color]::FromArgb(120,128,132);$versionLabel.Font=[Drawing.Font]::new('Segoe UI',9);$form.Controls.Add($versionLabel)
$frames=@('|','/','-','\');$index=0
$timer=[Windows.Forms.Timer]::new();$timer.Interval=120;$timer.Add_Tick({if(Test-Path -LiteralPath $DoneFile){$timer.Stop();$form.Close();return};$script:index=($script:index+1)%$frames.Count;$spinner.Text=$frames[$script:index]});$timer.Start()
[Windows.Forms.Application]::Run($form)
