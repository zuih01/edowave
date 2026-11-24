# Abre la ventana moderna de Windows para elegir una carpeta (la misma del Explorador: barra de dirección,
# accesos rápidos, búsqueda) y escribe la ruta elegida. No escribe nada si se cancela.
$codigo = @'
using System;
using System.Runtime.InteropServices;

public static class ElegirCarpeta {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialog {}

  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(); void SetFileTypeIndex(); void GetFileTypeIndex(); void Advise(); void Unadvise();
    void SetOptions(uint fos);
    void GetOptions(out uint fos);
    void SetDefaultFolder(); void SetFolder(); void GetFolder(); void GetCurrentSelection(); void SetFileName();
    void GetFileName();
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel();
    void GetResult(out IShellItem item);
  }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(); void GetParent();
    void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
  }

  public static string Abrir(string titulo) {
    var d = (IFileDialog)new FileOpenDialog();
    uint op; d.GetOptions(out op);
    d.SetOptions(op | 0x20 | 0x40); // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM
    d.SetTitle(titulo);
    d.SetOkButtonLabel("Comparar esta carpeta");
    if (d.Show(IntPtr.Zero) != 0) return null; // cancelado
    IShellItem item; d.GetResult(out item);
    string ruta; item.GetDisplayName(0x80058000, out ruta); // SIGDN_FILESYSPATH
    return ruta;
  }
}
'@
Add-Type -TypeDefinition $codigo -Language CSharp
$ruta = [ElegirCarpeta]::Abrir('Elige la carpeta con tu música')
if ($ruta) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $ruta }
