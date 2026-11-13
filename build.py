"""Package this folder as a VSIX without npm or vsce.

Usage:  python build.py   then   code --install-extension ai-usage-alijany.vsix --force
"""
import json
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

here = Path(__file__).parent
pkg = json.loads((here / "package.json").read_text(encoding="utf-8"))
files = [
    "package.json",
    "extension.js",
    "usage.js",
    "budget.js",
    "icon.png",
    "README.md",
    "LICENSE",
]

content_types = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".png" ContentType="image/png"/>
  <Default Extension=".md" ContentType="text/markdown"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
  <Override PartName="/extension/LICENSE" ContentType="text/plain"/>
</Types>
"""

manifest = f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="{pkg['name']}" Version="{pkg['version']}" Publisher="{pkg['publisher']}"/>
    <DisplayName>{escape(pkg['displayName'])}</DisplayName>
    <Description xml:space="preserve">{escape(pkg['description'])}</Description>
    <GalleryFlags>Public</GalleryFlags>
    <Icon>extension/{escape(pkg['icon'])}</Icon>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{pkg['engines']['vscode']}"/>
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/{escape(pkg['icon'])}"/>
  </Assets>
</PackageManifest>
"""

out = here / f"{pkg['name']}.vsix"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", content_types)
    z.writestr("extension.vsixmanifest", manifest)
    for name in files:
        z.write(here / name, f"extension/{name}")
print(out)
