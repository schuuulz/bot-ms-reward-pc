// Icone do msr.exe a partir de um PNG, so com o que ja vem no Windows: PowerShell 5.1 e .NET
// (System.Drawing para redimensionar, API de recursos do Windows para gravar no executavel).
// Usado pelo build (scripts/build-exe.js); nada disto vai para dentro do exe.

import { powershell } from '../src/win.js';

// C# 5 (o compilador do .NET Framework que o PowerShell 5.1 usa). Vai por stdin, nao pela linha
// de comando, entao pode ter aspas a vontade.
const SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class MsrIcon
{
    // Tamanhos que o Windows pede (Explorer, barra de tarefas, Alt+Tab) nas escalas 100% a 200%.
    static readonly int[] Sizes = { 16, 20, 24, 32, 40, 48, 64, 256 };

    public static void PngToIco(string png, string ico)
    {
        var images = new List<byte[]>();
        using (var source = new Bitmap(png))
        {
            Rectangle art = Artwork(source);
            foreach (int size in Sizes) images.Add(Render(source, art, size));
        }
        using (var w = new BinaryWriter(File.Create(ico)))
        {
            w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)Sizes.Length);
            int offset = 6 + 16 * Sizes.Length;
            for (int i = 0; i < Sizes.Length; i++)
            {
                w.Write((byte)(Sizes[i] & 0xFF)); w.Write((byte)(Sizes[i] & 0xFF)); // 256 vira 0
                w.Write((byte)0); w.Write((byte)0);
                w.Write((ushort)1); w.Write((ushort)32);
                w.Write(images[i].Length); w.Write(offset);
                offset += images[i].Length;
            }
            foreach (byte[] image in images) w.Write(image);
        }
    }

    // O quadrado que contem o desenho, sem a margem transparente em volta: num icone de 16 px
    // cada pixel de margem faz falta.
    static Rectangle Artwork(Bitmap source)
    {
        int w = source.Width, h = source.Height;
        byte[] px = Pixels(source, w, h);
        int left = w, top = h, right = -1, bottom = -1;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                if (px[(y * w + x) * 4 + 3] > 24)
                {
                    if (x < left) left = x;
                    if (x > right) right = x;
                    if (y < top) top = y;
                    if (y > bottom) bottom = y;
                }
        if (right < left) return new Rectangle(0, 0, w, h); // imagem toda transparente: usa inteira
        int side = Math.Max(right - left + 1, bottom - top + 1);
        side += Math.Max(2, side / 32); // um respiro de ~3%
        return new Rectangle((left + right + 1 - side) / 2, (top + bottom + 1 - side) / 2, side, side);
    }

    static byte[] Pixels(Bitmap bmp, int w, int h)
    {
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            var px = new byte[w * h * 4];
            for (int y = 0; y < h; y++) Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), px, y * w * 4, w * 4);
            return px;
        }
        finally { bmp.UnlockBits(data); }
    }

    static byte[] Render(Bitmap source, Rectangle art, int size)
    {
        using (var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(bmp))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.DrawImage(source, new Rectangle(0, 0, size, size), art, GraphicsUnit.Pixel);
            }
            if (size < 256) return Dib(Pixels(bmp, size, size), size);
            using (var ms = new MemoryStream())
            {
                bmp.Save(ms, ImageFormat.Png);
                return ms.ToArray();
            }
        }
    }

    // Formato classico de icone: BITMAPINFOHEADER + pixels BGRA de baixo para cima + mascara de
    // 1 bit (transparente onde o alfa e zero). Os menores vao assim; so o de 256 vai em PNG.
    static byte[] Dib(byte[] px, int size)
    {
        int maskRow = ((size + 31) / 32) * 4;
        using (var ms = new MemoryStream())
        using (var w = new BinaryWriter(ms))
        {
            w.Write(40); w.Write(size); w.Write(size * 2); w.Write((ushort)1); w.Write((ushort)32);
            w.Write(0); w.Write(size * size * 4 + maskRow * size); w.Write(0); w.Write(0); w.Write(0); w.Write(0);
            for (int y = size - 1; y >= 0; y--) w.Write(px, y * size * 4, size * 4);
            for (int y = size - 1; y >= 0; y--)
            {
                var row = new byte[maskRow];
                for (int x = 0; x < size; x++)
                    if (px[(y * size + x) * 4 + 3] == 0) row[x / 8] |= (byte)(0x80 >> (x % 8));
                w.Write(row);
            }
            w.Flush();
            return ms.ToArray();
        }
    }

    const int RT_ICON = 3, RT_GROUP_ICON = 14;
    const ushort ENGLISH_US = 1033;

    delegate bool EnumNamesProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
    delegate bool EnumLangsProc(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr param);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll")]
    static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumNamesProc callback, IntPtr param);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, EnumLangsProc callback, IntPtr param);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, int size);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool EndUpdateResource(IntPtr update, bool discard);

    // Um recurso que ja existe no executavel. O nome e um numero (id) ou um texto.
    class Existing { public int Type; public int Id; public string Name; public ushort Language; }

    static List<Existing> ExistingIcons(string exe)
    {
        var found = new List<Existing>();
        IntPtr module = LoadLibraryEx(exe, IntPtr.Zero, 0x2 | 0x20); // so os recursos, sem executar nada
        if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "nao consegui abrir " + exe);
        try
        {
            foreach (int type in new[] { RT_GROUP_ICON, RT_ICON })
            {
                int kind = type;
                EnumResourceNames(module, (IntPtr)kind, delegate(IntPtr m, IntPtr t, IntPtr name, IntPtr p)
                {
                    bool isId = ((ulong)name.ToInt64() >> 16) == 0;
                    int id = isId ? (int)name.ToInt64() : 0;
                    string text = isId ? null : Marshal.PtrToStringUni(name);
                    EnumResourceLanguages(m, t, name, delegate(IntPtr m2, IntPtr t2, IntPtr n2, ushort language, IntPtr p2)
                    {
                        found.Add(new Existing { Type = kind, Id = id, Name = text, Language = language });
                        return true;
                    }, IntPtr.Zero);
                    return true;
                }, IntPtr.Zero);
            }
        }
        finally { FreeLibrary(module); }
        return found;
    }

    static void Put(IntPtr update, int type, IntPtr name, ushort language, byte[] data)
    {
        if (!UpdateResource(update, (IntPtr)type, name, language, data, data == null ? 0 : data.Length))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "UpdateResource falhou");
    }

    // Troca todos os icones do executavel pelos do .ico. Os outros recursos nao sao tocados.
    public static void SetExeIcon(string exe, string ico)
    {
        byte[] file = File.ReadAllBytes(ico);
        int count = BitConverter.ToUInt16(file, 4);
        if (BitConverter.ToUInt16(file, 2) != 1 || count == 0) throw new InvalidDataException("nao e um .ico: " + ico);
        List<Existing> old = ExistingIcons(exe);

        IntPtr update = BeginUpdateResource(exe, false);
        if (update == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "BeginUpdateResource falhou");
        bool done = false;
        try
        {
            foreach (Existing r in old)
            {
                IntPtr name = r.Name == null ? (IntPtr)r.Id : Marshal.StringToHGlobalUni(r.Name);
                try { Put(update, r.Type, name, r.Language, null); }
                finally { if (r.Name != null) Marshal.FreeHGlobal(name); }
            }
            // O grupo e o indice do .ico com o id de cada imagem no lugar da posicao no arquivo.
            var group = new MemoryStream();
            var w = new BinaryWriter(group);
            w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)count);
            for (int i = 0; i < count; i++)
            {
                int entry = 6 + 16 * i;
                int size = BitConverter.ToInt32(file, entry + 8);
                int offset = BitConverter.ToInt32(file, entry + 12);
                var image = new byte[size];
                Buffer.BlockCopy(file, offset, image, 0, size);
                Put(update, RT_ICON, (IntPtr)(i + 1), ENGLISH_US, image);
                w.Write(file, entry, 12); w.Write((ushort)(i + 1));
            }
            w.Flush();
            Put(update, RT_GROUP_ICON, (IntPtr)1, ENGLISH_US, group.ToArray());
            if (!EndUpdateResource(update, false)) throw new Win32Exception(Marshal.GetLastWin32Error(), "EndUpdateResource falhou");
            done = true;
        }
        finally { if (!done) EndUpdateResource(update, true); }
    }
}
`;

const run = (call, env) =>
  powershell(
    `$ErrorActionPreference = 'Stop'; Add-Type -TypeDefinition ([Console]::In.ReadToEnd()) -ReferencedAssemblies System.Drawing; ${call}`,
    { env, input: SOURCE, timeout: 120000 },
  );

/** Gera um .ico com varios tamanhos a partir do PNG (quadrado, com transparencia). */
export const pngToIco = (png, ico) => run('[MsrIcon]::PngToIco($env:MSR_PNG, $env:MSR_ICO)', { MSR_PNG: png, MSR_ICO: ico });

/** Troca o icone de um executavel pelo do .ico. */
export const setExeIcon = (exe, ico) => run('[MsrIcon]::SetExeIcon($env:MSR_EXE, $env:MSR_ICO)', { MSR_EXE: exe, MSR_ICO: ico });
