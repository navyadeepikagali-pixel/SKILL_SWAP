[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $(if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) { (Get-Location).Path } else { $PSScriptRoot }) "Skill-Swap-Project-Presentation.pptx")
)

$ErrorActionPreference = "Stop"

function Get-OleColor {
    param([int]$Red, [int]$Green, [int]$Blue)
    return $Red + ($Green * 256) + ($Blue * 65536)
}

function Add-Text {
    param(
        $Slide,
        [double]$X,
        [double]$Y,
        [double]$Width,
        [double]$Height,
        [string]$Text,
        [double]$Size = 18,
        [int]$Color = 16777215,
        [bool]$Bold = $false,
        [int]$Alignment = 1
    )

    $shape = $Slide.Shapes.AddTextbox(1, $X, $Y, $Width, $Height)
    $shape.Fill.Visible = 0
    $shape.Line.Visible = 0
    $shape.TextFrame.WordWrap = -1
    $shape.TextFrame.MarginLeft = 0
    $shape.TextFrame.MarginRight = 0
    $shape.TextFrame.MarginTop = 0
    $shape.TextFrame.MarginBottom = 0
    $shape.TextFrame.VerticalAnchor = 1
    $shape.TextFrame.TextRange.Text = $Text
    $shape.TextFrame.TextRange.Font.Name = "Aptos"
    $shape.TextFrame.TextRange.Font.Size = $Size
    $shape.TextFrame.TextRange.Font.Bold = [int]$Bold
    $shape.TextFrame.TextRange.Font.Color.RGB = $Color
    $shape.TextFrame.TextRange.ParagraphFormat.Alignment = $Alignment
    return $shape
}

function Add-Rectangle {
    param(
        $Slide,
        [double]$X,
        [double]$Y,
        [double]$Width,
        [double]$Height,
        [int]$Color,
        [bool]$Rounded = $false
    )

    $shapeType = 1
    if ($Rounded) {
        $shapeType = 5
    }
    $shape = $Slide.Shapes.AddShape($shapeType, $X, $Y, $Width, $Height)
    $shape.Fill.ForeColor.RGB = $Color
    $shape.Line.Visible = 0
    return $shape
}

function Add-Card {
    param(
        $Slide,
        [double]$X,
        [double]$Y,
        [double]$Width,
        [double]$Height,
        [string]$Title,
        [string]$Body,
        [int]$Accent
    )

    Add-Rectangle $Slide $X $Y $Width $Height $script:Palette.Card $true | Out-Null
    Add-Rectangle $Slide ($X + 18) ($Y + 18) 5 ($Height - 36) $Accent | Out-Null
    Add-Text $Slide ($X + 38) ($Y + 20) ($Width - 58) 30 $Title 19 $script:Palette.White $true | Out-Null
    Add-Text $Slide ($X + 38) ($Y + 58) ($Width - 58) ($Height - 72) $Body 15 $script:Palette.Muted | Out-Null
}

function Add-ContentSlide {
    param($Presentation, [string]$Section, [string]$Title)

    $slide = $Presentation.Slides.Add($Presentation.Slides.Count + 1, 12)
    $slide.FollowMasterBackground = 0
    $slide.Background.Fill.ForeColor.RGB = $script:Palette.Background
    Add-Text $slide 54 32 850 20 $Section.ToUpperInvariant() 10 $script:Palette.Mint $true | Out-Null
    Add-Text $slide 54 62 850 48 $Title 30 $script:Palette.White $true | Out-Null
    Add-Rectangle $slide 54 119 54 4 $script:Palette.Mint | Out-Null
    Add-Text $slide 54 511 650 16 "SKILL SWAP  |  PROJECT OVERVIEW" 9 $script:Palette.Muted | Out-Null
    Add-Text $slide 866 511 40 16 ([string]$slide.SlideIndex) 9 $script:Palette.Muted $false 3 | Out-Null
    return $slide
}

$script:Palette = @{
    Background = Get-OleColor 12 24 40
    Card       = Get-OleColor 23 41 61
    White      = Get-OleColor 244 248 252
    Muted      = Get-OleColor 173 190 205
    Mint       = Get-OleColor 75 220 185
    Blue       = Get-OleColor 86 161 255
    Orange     = Get-OleColor 255 175 92
    Purple     = Get-OleColor 175 145 255
}

$powerPoint = $null
$presentation = $null
$slide = $null

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw "This generator requires Windows and desktop Microsoft PowerPoint."
    }

    $resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
    $outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutputPath)
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
        throw "Output directory does not exist: $outputDirectory"
    }

    $powerPoint = New-Object -ComObject PowerPoint.Application
    $powerPoint.Visible = -1
    $powerPoint.DisplayAlerts = 1
    $presentation = $powerPoint.Presentations.Add()
    $presentation.PageSetup.SlideSize = 16

    # 1. Title
    $slide = $presentation.Slides.Add(1, 12)
    $slide.FollowMasterBackground = 0
    $slide.Background.Fill.ForeColor.RGB = $script:Palette.Background
    Add-Rectangle $slide 0 0 12 540 $script:Palette.Mint | Out-Null
    Add-Text $slide 62 58 600 22 "PEER-POWERED LEARNING" 11 $script:Palette.Mint $true | Out-Null
    Add-Text $slide 62 112 660 100 "SKILL SWAP" 54 $script:Palette.White $true | Out-Null
    Add-Text $slide 64 214 600 76 "Learn together.`nGrow together." 28 $script:Palette.Muted $false | Out-Null
    Add-Text $slide 64 332 610 58 "A platform where people teach what they know and learn what they want." 19 $script:Palette.White | Out-Null
    Add-Rectangle $slide 720 96 176 176 $script:Palette.Card $true | Out-Null
    Add-Text $slide 746 126 124 36 "TEACH" 20 $script:Palette.Mint $true 2 | Out-Null
    Add-Text $slide 746 172 124 36 "<>" 30 $script:Palette.White $true 2 | Out-Null
    Add-Text $slide 746 220 124 36 "LEARN" 20 ($script:Palette.Orange) $true 2 | Out-Null
    Add-Text $slide 64 490 680 18 "FULL-STACK SKILL-EXCHANGE APPLICATION" 10 $script:Palette.Muted $true | Out-Null
    Add-Text $slide 832 490 72 18 "01 / 08" 10 $script:Palette.Muted $false 3 | Out-Null

    # 2. Goal and problem statement
    $slide = Add-ContentSlide $presentation "01  /  GOAL" "The learning gap is access"
    Add-Text $slide 70 153 820 22 "PROBLEM + SOLUTION" 11 $script:Palette.Mint $true | Out-Null
    Add-Text $slide 70 194 820 130 "People who want to learn often struggle to find accessible, trusted peers. Skill Swap connects learners and tutors to exchange skills through profiles, discovery, chat, scheduling and credit-based sessions." 26 $script:Palette.White $true | Out-Null
    Add-Rectangle $slide 70 354 820 94 $script:Palette.Card $true | Out-Null
    Add-Text $slide 94 374 770 55 "The core idea: everyone can be both a learner and a teacher." 19 $script:Palette.Muted | Out-Null

    # 3. User journey
    $slide = Add-ContentSlide $presentation "02  /  EXPERIENCE" "A simple learning loop"
    Add-Card $slide 54 160 202 252 "01  SHARE" "Build a profile. Add skills you can teach and skills you want to learn." $script:Palette.Mint
    Add-Card $slide 278 160 202 252 "02  DISCOVER" "Find learning partners with filters for skill, level, language and availability." $script:Palette.Blue
    Add-Card $slide 502 160 202 252 "03  CONNECT" "Send a request, build a connection and continue the conversation in chat." $script:Palette.Orange
    Add-Card $slide 726 160 180 252 "04  SWAP" "Schedule a session, learn together, confirm completion and exchange credits." $script:Palette.Purple
    Add-Text $slide 68 438 824 28 "One community. Two-way learning. Progress built through sharing." 17 $script:Palette.Muted $false 2 | Out-Null

    # 4. Scope and deliverables
    $slide = Add-ContentSlide $presentation "03  /  SCOPE" "Scope & key deliverables"
    Add-Card $slide 54 146 410 157 "Profiles & skill catalog" "Editable profiles, categorized skills, teach/learn lists, and moderated skill suggestions." $script:Palette.Mint
    Add-Card $slide 496 146 410 157 "Discovery & communication" "Filtered tutor search, connection requests, persistent chat, live messages and notifications." $script:Palette.Blue
    Add-Card $slide 54 326 410 157 "Sessions & trust" "Availability, timezone-aware scheduling, session lifecycle, reviews and dispute handling." $script:Palette.Orange
    Add-Card $slide 496 326 410 157 "Credits & administration" "Wallet ledger, completion-based settlement, usage limits, plans, and admin oversight." $script:Palette.Purple

    # 5. Technical architecture
    $slide = Add-ContentSlide $presentation "04  /  BUILD" "A full-stack application"
    Add-Card $slide 54 158 198 230 "FRONTEND" "React 18`nVite`nReact Router`nAxios`nSocket.IO client" $script:Palette.Mint
    Add-Card $slide 278 158 198 230 "API & SERVICES" "Node.js`nExpress`nAuthentication`nScheduling`nWallet & usage services" $script:Palette.Blue
    Add-Card $slide 502 158 198 230 "DATA" "MongoDB`nMongoose`nDomain models`nIndexes`nTransaction-backed flows" $script:Palette.Orange
    Add-Card $slide 726 158 180 230 "REAL TIME" "Socket.IO`nAuthenticated rooms`nMessages`nNotifications`nPresence" $script:Palette.Purple
    Add-Text $slide 70 420 820 48 "Secure cookies, role checks, idempotency, and participant authorization support reliable everyday flows." 17 $script:Palette.Muted $false 2 | Out-Null

    # 6. Challenges and responses
    $slide = Add-ContentSlide $presentation "05  /  ENGINEERING" "Challenges solved in the product"
    Add-Card $slide 54 150 410 154 "Reliable credit settlement" "Transactions and idempotent actions help prevent duplicate or partial transfers." $script:Palette.Mint
    Add-Card $slide 496 150 410 154 "Scheduling across time zones" "Store a clear instant and timezone; check availability and overlapping bookings." $script:Palette.Blue
    Add-Card $slide 54 330 410 154 "Private, real-time conversations" "Authenticate sockets and authorize room access against conversation participants." $script:Palette.Orange
    Add-Card $slide 496 330 410 154 "Trust and payment clarity" "Use verified auth and admin controls; demo checkout is explicitly unpaid without a provider." $script:Palette.Purple

    # 7. Conclusion
    $slide = Add-ContentSlide $presentation "06  /  OUTCOME" "Learning becomes a two-way exchange"
    Add-Text $slide 70 159 820 82 "Skill Swap brings discovery, connection, scheduling and learning credits into one end-to-end experience." 27 $script:Palette.White $true | Out-Null
    Add-Card $slide 70 286 390 151 "What the project delivers" "A working foundation for a peer-learning community, with operational tools for trust and administration." $script:Palette.Mint
    Add-Card $slide 500 286 390 151 "Honest boundary" "A payment provider is not configured; subscription checkout remains a demo and does not grant paid access." $script:Palette.Orange

    # 8. Thank you
    $slide = $presentation.Slides.Add(8, 12)
    $slide.FollowMasterBackground = 0
    $slide.Background.Fill.ForeColor.RGB = $script:Palette.Background
    Add-Rectangle $slide 0 0 12 540 $script:Palette.Mint | Out-Null
    Add-Text $slide 90 108 780 24 "SKILL SWAP" 12 $script:Palette.Mint $true 2 | Out-Null
    Add-Text $slide 90 172 780 78 "Thank You" 52 $script:Palette.White $true 2 | Out-Null
    Add-Text $slide 150 280 660 62 "Learn together. Grow together." 25 $script:Palette.Muted $false 2 | Out-Null
    Add-Rectangle $slide 330 380 300 2 $script:Palette.Card | Out-Null
    Add-Text $slide 150 410 660 24 "Reference website: talentsprint.com" 14 $script:Palette.Muted $false 2 | Out-Null
    Add-Text $slide 832 490 72 18 "08 / 08" 10 $script:Palette.Muted $false 3 | Out-Null

    $presentation.SaveAs($resolvedOutputPath, 24)
    Write-Host "Presentation created: $resolvedOutputPath"
}
catch {
    Write-Error "Could not create the Skill Swap presentation. $($_.Exception.Message)"
    throw
}
finally {
    if ($null -ne $presentation) {
        $presentation.Close()
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)
    }
    if ($null -ne $powerPoint) {
        $powerPoint.Quit()
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
