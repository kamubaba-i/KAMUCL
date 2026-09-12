// Only restore DWM composition on windows owned by the launching Electron process.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

internal static class WindowMaterial {
    [StructLayout(LayoutKind.Sequential)] struct Margins { public int Left, Right, Top, Bottom; }
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr window, IntPtr region, bool redraw);
    [DllImport("dwmapi.dll")] static extern int DwmExtendFrameIntoClientArea(IntPtr window, ref Margins margins);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public int Size; public Rect Bounds, Work; public uint Flags; }
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr window, int index, int value);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    static readonly Dictionary<IntPtr, int> frameBits = new Dictionary<IntPtr, int>();
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    static int Main(string[] args) {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        uint owner;
        if (args.Length != 1 || !uint.TryParse(args[0], out owner)) return 2;
        string line;
        while ((line = Console.ReadLine()) != null) {
            long value;
            var parts = line.Split(' ');
            if (parts.Length != 2 || !long.TryParse(parts[0], out value)) continue;
            var window = new IntPtr(value);
            uint actual;
            GetWindowThreadProcessId(window, out actual);
            if (actual != owner) { Console.WriteLine("denied"); continue; }
            // Keep WS_MAXIMIZE and WINDOWPLACEMENT authoritative. Chromium's rounded
            // clipping region disables DWM backdrop; removing it alone exposes the
            // invisible resize border on adjacent monitors. Drop only caption/frame
            // bits while zoomed and fit that client area to the native work area.
            // SWP_NOSENDCHANGING prevents Chromium from adding its cached frame back.
            // Normal windows recover their original resize frame and native placement.
            const int styleIndex = -16, frameMask = 0x00C40000;
            int style = GetWindowLong(window, styleIndex);
            if (!frameBits.ContainsKey(window)) frameBits[window] = style & frameMask;
            bool maximized = IsZoomed(window);
            int desired = maximized ? style & ~frameMask : style | frameBits[window];
            if (style != desired) {
                SetWindowLong(window, styleIndex, desired);
                if (maximized) {
                    var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
                    if (GetMonitorInfo(MonitorFromWindow(window, 2), ref info))
                        SetWindowPos(window, IntPtr.Zero, info.Work.Left, info.Work.Top,
                            info.Work.Right-info.Work.Left, info.Work.Bottom-info.Work.Top, 0x434);
                } else SetWindowPos(window, IntPtr.Zero, 0, 0, 0, 0, 0x37);
            }
            SetWindowRgn(window, IntPtr.Zero, true);
            var margins = new Margins { Left = -1, Right = -1, Top = -1, Bottom = -1 };
            int dark = parts[1] == "dark" ? 1 : 0, backdrop = 3, caption = -2;
            DwmSetWindowAttribute(window, 20, ref dark, 4);
            DwmSetWindowAttribute(window, 35, ref caption, 4);
            DwmSetWindowAttribute(window, 38, ref backdrop, 4);
            Console.WriteLine(DwmExtendFrameIntoClientArea(window, ref margins));
        }
        return 0;
    }
}
