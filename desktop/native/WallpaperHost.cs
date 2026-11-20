using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
public static class SonicWallpaper {
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int Size; public Rect Monitor; public Rect Work; public uint Flags; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr window, uint msg, IntPtr wp, IntPtr lp, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetParent(IntPtr window, IntPtr parent);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetLong(IntPtr window,int index);
  [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetLong(IntPtr window,int index,IntPtr value);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window,uint flags);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr window,ref Point point);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr window);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window,int attribute,out Rect value,int size);
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
  static IntPtr Parent, OriginalParent, OriginalStyle, Progman;
  static Rect OriginalBounds, TargetBounds;
  static bool Attached;
  static IntPtr Discover(IntPtr target) {
    IntPtr classic=IntPtr.Zero, raised=IntPtr.Zero;
    MonitorInfo info=new MonitorInfo();info.Size=Marshal.SizeOf(typeof(MonitorInfo));GetMonitorInfo(MonitorFromWindow(target,2),ref info);
    EnumWindows(delegate(IntPtr top,IntPtr _) {
      if(FindWindowEx(top,IntPtr.Zero,"SHELLDLL_DefView",null)!=IntPtr.Zero) {
        IntPtr next=FindWindowEx(IntPtr.Zero,top,"WorkerW",null);
        if(next!=IntPtr.Zero)classic=next;
      }
      return true;
    },IntPtr.Zero);
    if(Progman!=IntPtr.Zero){
      IntPtr match=FindWindowEx(Progman,IntPtr.Zero,"WorkerW",null);
      while(match!=IntPtr.Zero){
        Rect rect;
        if(GetWindowRect(match,out rect)&&FindWindowEx(match,IntPtr.Zero,"SHELLDLL_DefView",null)==IntPtr.Zero&&Covers(rect,info.Monitor,10)){raised=match;break;}
        match=FindWindowEx(Progman,match,"WorkerW",null);
      }
    }
    return raised!=IntPtr.Zero?raised:classic;
  }
  public static void Attach(IntPtr window) {
    if(!IsWindow(window))throw new Exception("应用窗口已关闭。");
    try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){}
    Progman=FindWindow("Progman",null);
    OriginalParent=GetParent(window);OriginalStyle=GetLong(window,-16);GetWindowRect(window,out OriginalBounds);
    MonitorInfo info=new MonitorInfo();info.Size=Marshal.SizeOf(typeof(MonitorInfo));GetMonitorInfo(MonitorFromWindow(window,2),ref info);
    TargetBounds=info.Monitor;
    Parent=Discover(window);
    if(Parent==IntPtr.Zero&&Progman!=IntPtr.Zero){
      IntPtr result;
      SendMessageTimeout(Progman,0x052C,IntPtr.Zero,IntPtr.Zero,2,1500,out result);
      for(int attempts=0;attempts<10&&Parent==IntPtr.Zero;attempts++){Thread.Sleep(100);Parent=Discover(window);}
    }
    if(Parent==IntPtr.Zero)throw new Exception("当前桌面没有可用的壁纸层，请使用普通窗口或迷你播放器。");
    long style=OriginalStyle.ToInt64();style=(style&~0x00C40000L&~0x80000000L)|0x40000000L;
    Attached=true;
    SetLong(window,-16,new IntPtr(style));SetParent(window,Parent);
    if(GetParent(window)!=Parent)throw new Exception("无法挂接桌面，已保留普通窗口。");
    Point point=new Point();point.X=info.Monitor.Left;point.Y=info.Monitor.Top;ScreenToClient(Parent,ref point);
    if(!SetWindowPos(window,IntPtr.Zero,point.X,point.Y,info.Monitor.Right-info.Monitor.Left,info.Monitor.Bottom-info.Monitor.Top,0x0020|0x0040|0x0010))throw new Exception("无法调整动态桌面的尺寸。");
  }
  public static void Restore(IntPtr window) {
    if(!Attached||!IsWindow(window))return;
    Attached=false;
    SetParent(window,OriginalParent);SetLong(window,-16,OriginalStyle);
    SetWindowPos(window,IntPtr.Zero,OriginalBounds.Left,OriginalBounds.Top,OriginalBounds.Right-OriginalBounds.Left,OriginalBounds.Bottom-OriginalBounds.Top,0x0020|0x0040|0x0010);
  }
  static bool Covers(Rect area,Rect target,int tolerance) {
    return target.Right>target.Left&&target.Bottom>target.Top&&area.Left<=target.Left+tolerance&&area.Top<=target.Top+tolerance&&area.Right>=target.Right-tolerance&&area.Bottom>=target.Bottom-tolerance;
  }
  static bool IsCovered(IntPtr window) {
    IntPtr foreground=GetForegroundWindow();
    if(foreground==IntPtr.Zero||foreground==Progman||foreground==window||foreground==Parent||
       FindWindowEx(foreground,IntPtr.Zero,"SHELLDLL_DefView",null)!=IntPtr.Zero)return false;
    Rect bounds;
    if(DwmGetWindowAttribute(foreground,9,out bounds,Marshal.SizeOf(typeof(Rect)))!=0&&!GetWindowRect(foreground,out bounds))return false;
    if(Covers(bounds,TargetBounds,3))return true;
    MonitorInfo monitor=new MonitorInfo();monitor.Size=Marshal.SizeOf(typeof(MonitorInfo));
    return IsZoomed(foreground)&&GetMonitorInfo(MonitorFromWindow(foreground,2),ref monitor)&&Covers(monitor.Monitor,TargetBounds,3)&&Covers(bounds,monitor.Work,3);
  }
  public static int Main(string[] arguments) {
    Console.OutputEncoding=new System.Text.UTF8Encoding(false);
    long value;
    if(arguments.Length!=1||!long.TryParse(arguments[0],NumberStyles.None,CultureInfo.InvariantCulture,out value)||value<=0)return 2;
    IntPtr window=new IntPtr(value);
    try {
      Attach(window);
      Console.WriteLine("attached");
      var exit=Task.Factory.StartNew(()=>Console.ReadLine());
      bool? lastCovered=null;
      while(!exit.Wait(350)) {
        if(!IsWindow(window)||!IsWindow(Parent)||GetParent(window)!=Parent)throw new Exception("桌面层已变更，可重新开启动态桌面。");
        bool covered=IsCovered(window);
        if(lastCovered!=covered){Console.WriteLine(covered?"covered":"visible");lastCovered=covered;}
      }
      return 0;
    } catch(Exception error) {
      Console.Error.WriteLine(error.Message);
      return 1;
    } finally { Restore(window); }
  }
}
