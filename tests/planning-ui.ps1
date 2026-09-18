$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,System.Web.Extensions
$root=Split-Path $PSScriptRoot -Parent
$assembly=[Reflection.Assembly]::LoadFile((Join-Path $root 'SDIS-Collegues.exe'))
$flags=[Reflection.BindingFlags]'Instance,NonPublic'
$serializer=New-Object System.Web.Script.Serialization.JavaScriptSerializer
$fixture='{"from":"2026-09-18","to":"2026-10-15","events":[{"dates":["2026-09-18"],"text":"Formation avec un intitule tres long conserve integralement","startTime":"09:00","endTime":"12:00","indispo":false},{"dates":["2026-09-18"],"text":"Garde","startTime":"18:00","endTime":"23:00","indispo":true},{"dates":["2026-09-19"],"text":"Garde seule","indispo":true},{"dates":["2026-09-20"],"text":"Formation seule","indispo":false}]}'
$formType=$assembly.GetType('MainForm');$form=[Activator]::CreateInstance($formType)
try {
 $form.Opacity=0;$form.Show();[Windows.Forms.Application]::DoEvents()
 $originalSize=$form.ClientSize;$originalState=$form.WindowState
 $busy=$formType.GetMethod('SetBusy',$flags)
 $busy.Invoke($form,[object[]]@($true,'Synchronisation',$true))|Out-Null
 if($formType.GetField('reposCard',$flags).GetValue($form).Visible){throw 'La carte repos reste visible pendant la synchronisation'}
 $data=$serializer.DeserializeObject($fixture)
 $formType.GetMethod('ShowDendreoCalendarScreen',$flags).Invoke($form,[object[]]@($data))|Out-Null
 $busy.Invoke($form,[object[]]@($false,'',$false))|Out-Null
 if($form.ClientSize -ne $originalSize -or $form.WindowState -ne $originalState){throw 'Dimensions ou proportions modifiees'}
 if($formType.GetField('reposCard',$flags).GetValue($form).Visible){throw 'La carte repos reste visible dans le planning'}
 $preview=$formType.GetField('calendarPreview',$flags).GetValue($form)
 foreach($control in $preview.Controls){foreach($child in $control.Controls){if($child.Text -eq 'Retour'){throw 'Bouton Retour present'}}}
 $agenda=@($preview.Controls|Where-Object {$_.GetType().Name -eq 'Planning28Agenda'})[0]
 $type=$agenda.GetType();$canvas=$type.GetField('canvas',$flags).GetValue($agenda)
 foreach($width in @(560,1080)){
  $agenda.Size=[Drawing.Size]::new($width,580)
  $type.GetMethod('LayoutPlanning',$flags).Invoke($agenda,@())|Out-Null
  $days=$type.GetField('days',$flags).GetValue($agenda)
  if($days.Count -ne 28){throw 'Les 28 jours ne sont pas tous presents'}
  foreach($day in $days){if(-not $canvas.ClientRectangle.Contains($day)){throw 'Une date sort de la grille'}}
 }
 $conflict=$type.GetMethod('HasConflict',$flags)
 foreach($day in @(18,19,20,21)){
  $actual=$conflict.Invoke($agenda,[object[]]@([datetime]::new(2026,9,$day)))
  if($actual -ne ($day -eq 18)){throw "Conflit incorrect pour le $day"}
 }
 $click=$type.GetMethod('SelectEntry',$flags)
 $click.Invoke($agenda,@($canvas,[Windows.Forms.MouseEventArgs]::new([Windows.Forms.MouseButtons]::Left,1,$days[0].X+5,$days[0].Y+5,0)))|Out-Null
 $detail=$type.GetField('detail',$flags).GetValue($agenda)
 if(-not $detail.Text.Contains('CONFLIT') -or -not $detail.Text.Contains('Formation') -or -not $detail.Text.Contains('Garde')){throw 'Details du conflit incomplets'}
 $click.Invoke($agenda,@($canvas,[Windows.Forms.MouseEventArgs]::new([Windows.Forms.MouseButtons]::Left,1,$days[27].X+5,$days[27].Y+5,0)))|Out-Null
 if(-not $detail.Text.Contains('15 octobre 2026')){throw 'Dernier jour incorrect'}
 $entry=@($type.GetField('entries',$flags).GetValue($agenda)|Where-Object {-not $_.Unavailable})[0]
 $click.Invoke($agenda,@($canvas,[Windows.Forms.MouseEventArgs]::new([Windows.Forms.MouseButtons]::Left,1,$entry.Bounds.X+5,$entry.Bounds.Y+5,0)))|Out-Null
 if(-not $detail.Text.Contains($entry.Title)){throw 'Intitule complet absent'}
 Write-Output 'PASS: 28 jours, dimensions conservees, conflits, details complets, carte repos masquee et Retour supprime'
} finally {$form.Dispose()}
