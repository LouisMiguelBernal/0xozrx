use tauri_build::{Attributes, WindowsAttributes};

/// Windows application manifest.
///
/// requestedExecutionLevel = asInvoker:
///   Smooth, silent start - no UAC prompt on every open. Scanners are designed
///   to work unelevated; admin-only data (Secure Boot, TPM, Security log) is
///   reported as REQUIRES-ADMIN. When the user wants full rights they run the
///   `elevate` command, which relaunches through UAC once.
///
/// Everything else mirrors Tauri's default manifest (common-controls dep,
/// Win10/11 supportedOS, PerMonitorV2 DPI) so nothing regresses.
#[cfg(windows)]
const APP_MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v2">
    <security>
      <requestedPrivileges xmlns="urn:schemas-microsoft-com:asm.v3">
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <!-- Windows 10 and Windows 11 -->
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
    </application>
  </compatibility>
  <asmv3:application>
    <asmv3:windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">permonitorv2,permonitor</dpiAwareness>
    </asmv3:windowsSettings>
  </asmv3:application>
</assembly>
"#;

fn main() {
    let mut attrs = Attributes::new();

    #[cfg(windows)]
    {
        attrs = attrs.windows_attributes(WindowsAttributes::new().app_manifest(APP_MANIFEST));
    }

    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}
