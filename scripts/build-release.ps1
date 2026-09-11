#Requires -Version 5.1
<#
.SYNOPSIS
  Release build for OpenCode Stats (Windows).

.DESCRIPTION
  Runs the Tauri release build with RUSTFLAGS --remap-path-prefix so that
  build-machine paths (e.g. C:\Users\<name>\.cargo\...) are NOT embedded
  in the binary (they would otherwise leak via panic-location strings).
  No usernames or machine paths are hardcoded here: everything resolves
  from the environment of whoever runs it.

  Use this script (instead of plain `npm run tauri build`) for any
  binary that gets published to GitHub Releases.
#>
$ErrorActionPreference = "Stop"

$rustflagsAdd = "--remap-path-prefix=$($env:USERPROFILE)=~"
$oldFlags = $env:RUSTFLAGS
if ($oldFlags) {
  $env:RUSTFLAGS = "$oldFlags $rustflagsAdd"
} else {
  $env:RUSTFLAGS = $rustflagsAdd
}

try {
  npm run tauri build
} finally {
  $env:RUSTFLAGS = $oldFlags
}
