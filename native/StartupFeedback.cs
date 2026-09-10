using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Threading;
using System.Collections.Generic;
using System.Globalization;

// A single alpha-composited scene owns the complete portable startup.
sealed class StartupFeedback : Form {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int x,y; public Point(int a,int b){x=a;y=b;} }
    [StructLayout(LayoutKind.Sequential)] struct NativeSize { public int cx,cy; public NativeSize(int a,int b){cx=a;cy=b;} }
    [StructLayout(LayoutKind.Sequential,Pack=1)] struct Blend { public byte op,flags,alpha,format; }
    [StructLayout(LayoutKind.Sequential)] struct BitmapInfo {
        public uint size;public int width,height;public ushort planes,bits;public uint compression,imageSize;public int xppm,yppm;public uint used,important;
    }
    [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr w,IntPtr dst,ref Point pos,ref NativeSize size,IntPtr src,ref Point origin,int key,ref Blend blend,int flags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr w);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr w,IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc,ref BitmapInfo info,uint usage,out IntPtr bits,IntPtr section,uint offset);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr w);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action,uint parameter,ref bool value,uint flags);
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
    [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint period);
    readonly string signal; readonly int parentId; readonly Stopwatch clock=Stopwatch.StartNew();
    const double FrameMilliseconds=1000.0/60;
    System.Threading.Timer frameTimer; readonly object frameGate=new object();
    double nextFrame; int framePending; bool preciseTimer;
    readonly Bitmap face;
    readonly string frameProbe=Environment.GetEnvironmentVariable("KAMUCL_FRAME_PROBE");
    readonly List<double> frameTimes=new List<double>();
    Bitmap surface;IntPtr surfaceDC,surfaceImage,previousImage;
    readonly double[,] pixels=new double[64,5]; readonly bool reduced;
    bool reported,assembled; double convergence=-1,reveal=-1; string caption="正在启动…";
    float scale=1; int logicalWidth,logicalHeight,tile;
    StartupFeedback(string done,int pid){
        signal=done;parentId=pid;AutoScaleMode=AutoScaleMode.None;
        FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;
        StartPosition=FormStartPosition.Manual;Bounds=Screen.PrimaryScreen.Bounds;
        using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("face.png"))
        using(var source=new Bitmap(stream))face=new Bitmap(source);
        bool animation=true;SystemParametersInfo(0x1042,0,ref animation,0);reduced=!animation;
    }
    protected override bool ShowWithoutActivation{get{return true;}}
    protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x80000|0x08000000|0x20|0x80;return p;}}
    protected override void OnShown(EventArgs e){
        base.OnShown(e);scale=GetDpiForWindow(Handle)/96f;Geometry();TickScene();
        preciseTimer=timeBeginPeriod(1)==0;nextFrame=clock.Elapsed.TotalMilliseconds+FrameMilliseconds;
        frameTimer=new System.Threading.Timer(QueueFrame,null,0,1);
    }
    void QueueFrame(object state){
        lock(frameGate){
            double now=clock.Elapsed.TotalMilliseconds;
            if(now<nextFrame)return;
            // Absolute deadlines avoid adding render time to every frame. Late
            // frames are skipped, never queued into a burst on the UI thread.
            nextFrame+=FrameMilliseconds;
            if(nextFrame<=now)nextFrame=now+FrameMilliseconds;
            if(Interlocked.Exchange(ref framePending,1)!=0)return;
        }
        try{BeginInvoke((MethodInvoker)delegate{
            try{if(!IsDisposed)TickScene();}finally{Interlocked.Exchange(ref framePending,0);}
        });}catch(InvalidOperationException){Interlocked.Exchange(ref framePending,0);}
    }
    void Geometry(){
        logicalWidth=(int)Math.Round(Width/scale);logicalHeight=(int)Math.Round(Height/scale);
        tile=Math.Max(10,(int)Math.Floor(Math.Min(224,Math.Min(logicalWidth*.26,logicalHeight*.32))/8));
        var random=new Random(1041);
        for(int i=0;i<64;i++){
            pixels[i,0]=tile+random.NextDouble()*Math.Max(0,logicalWidth-tile*3);
            pixels[i,1]=logicalHeight*.28+random.NextDouble()*Math.Max(0,logicalHeight*.68-tile);
            pixels[i,2]=logicalHeight*(.09+random.NextDouble()*.06);pixels[i,3]=random.NextDouble()*180;pixels[i,4]=random.NextDouble()*Math.PI*2;
        }
    }
    static double Smooth(double v){v=Math.Max(0,Math.Min(1,v));return v*v*v*(v*(v*6-15)+10);}
    void TickScene(){
        try{using(var parent=Process.GetProcessById(parentId))if(parent.HasExited){Close();return;}}catch{Close();return;}
        if(clock.ElapsedMilliseconds>90000){Close();return;}
        string command="";try{if(File.Exists(signal))command=File.ReadAllText(signal);}catch{}
        if(command=="closed"||command=="fallback"){Close();return;}
        if(command.StartsWith("loading\n"))caption=command.Substring(8);
        double now=clock.Elapsed.TotalMilliseconds;
        if(command=="ready"&&convergence<0&&now>=900){convergence=now;caption="准备就绪";}
        if(command=="reveal"&&reveal<0)reveal=now;
        if(reveal>=0&&(reduced||now-reveal>=320)){Mark(".finished","done");Close();return;}
        EnsureSurface();PaintScene(surface,now);
        if(!Present(reveal<0?1:1-Smooth((now-reveal)/320))){Close();return;}
        if(!String.IsNullOrEmpty(frameProbe))frameTimes.Add(clock.Elapsed.TotalMilliseconds);
        if(!reported){reported=true;Mark(".visible",Process.GetCurrentProcess().Id.ToString());var probe=Environment.GetEnvironmentVariable("KAMUCL_BOOT_PROBE");if(!String.IsNullOrEmpty(probe))try{File.WriteAllText(probe,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString());}catch{}}
        if(!assembled&&convergence>=0&&now-convergence>=(reduced?0:620+2000)){assembled=true;Mark(".assembled",reduced?"reduced":"ready");}
    }
    void Mark(string suffix,string value){try{File.WriteAllText(signal+suffix,value);}catch{}}
    static GraphicsPath Round(RectangleF r,float radius){var p=new GraphicsPath();float d=radius*2;p.AddArc(r.X,r.Y,d,d,180,90);p.AddArc(r.Right-d,r.Y,d,d,270,90);p.AddArc(r.Right-d,r.Bottom-d,d,d,0,90);p.AddArc(r.X,r.Bottom-d,d,d,90,90);p.CloseFigure();return p;}
    Bitmap DrawScene(double time){
        var bitmap=new Bitmap(Width,Height,PixelFormat.Format32bppPArgb);
        PaintScene(bitmap,time);return bitmap;
    }
    void PaintScene(Bitmap bitmap,double time){
        using(var g=Graphics.FromImage(bitmap)){
            g.Clear(Color.Transparent);g.ScaleTransform(scale,scale);g.SmoothingMode=SmoothingMode.AntiAlias;g.PixelOffsetMode=PixelOffsetMode.Half;g.TextRenderingHint=System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            for(int i=0;i<64;i++){
                double phase=pixels[i,4],ft=convergence<0?time:convergence,t=Math.Max(0,Math.Min(1,(ft-pixels[i,3])/650));
                double x=pixels[i,0]+Math.Sin(ft/500+phase)*3*t,y=pixels[i,1]-pixels[i,2]*Smooth(t)+Math.Sin(ft/600+phase)*2*t;
                double rotation=Math.Sin(ft/600+phase)*.035*t,progress=reduced?1:convergence<0?0:Smooth((time-convergence)/620);
                x+=(Math.Round((logicalWidth-tile*8)/2.0)+i%8*tile-x)*progress;
                y+=(Math.Round((logicalHeight-tile*8)/2.0)+i/8*tile-y)*progress;rotation*=1-progress;
                var state=g.Save();g.TranslateTransform((float)x+tile/2f,(float)y+tile/2f);g.RotateTransform((float)(rotation*180/Math.PI));
                using(var shadow=new SolidBrush(Color.FromArgb((int)(22*(1-progress)),12,18,25)))g.FillRectangle(shadow,-tile/2f+1,-tile/2f+2,tile,tile);
                g.InterpolationMode=InterpolationMode.NearestNeighbor;
                g.DrawImage(face,new RectangleF(-tile/2f,-tile/2f,tile,tile),new RectangleF(i%8*face.Width/8f,i/8*face.Height/8f,face.Width/8f,face.Height/8f),GraphicsUnit.Pixel);g.Restore(state);
            }
            var panel=new RectangleF(logicalWidth/2f-110,logicalHeight/2f+135,220,86);
            using(var outline=Round(panel,14))using(var fill=new SolidBrush(Color.FromArgb(184,23,32,33)))using(var border=new Pen(Color.FromArgb(36,255,255,255),1)){g.FillPath(fill,outline);g.DrawPath(border,outline);}
            using(var titleFont=new Font("Segoe UI",20,FontStyle.Bold,GraphicsUnit.Pixel))using(var textFont=new Font("Microsoft YaHei UI",12,FontStyle.Regular,GraphicsUnit.Pixel))using(var ink=new SolidBrush(Color.FromArgb(245,248,246)))using(var format=new StringFormat{Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center}){
                g.DrawString("KAMUCL",titleFont,ink,new RectangleF(panel.X,panel.Y+10,panel.Width,30),format);
                g.DrawString(caption,textFont,ink,new RectangleF(panel.X+10,panel.Y+44,panel.Width-20,25),format);
            }
        }
    }
    void EnsureSurface(){
        if(surface!=null&&surface.Width==Width&&surface.Height==Height)return;
        ReleaseSurface();surfaceDC=CreateCompatibleDC(IntPtr.Zero);
        var info=new BitmapInfo{size=(uint)Marshal.SizeOf(typeof(BitmapInfo)),width=Width,height=-Height,planes=1,bits=32};IntPtr pixels;
        surfaceImage=CreateDIBSection(surfaceDC,ref info,0,out pixels,IntPtr.Zero,0);
        if(surfaceDC==IntPtr.Zero||surfaceImage==IntPtr.Zero)throw new InvalidOperationException("Startup surface allocation failed");
        previousImage=SelectObject(surfaceDC,surfaceImage);
        surface=new Bitmap(Width,Height,Width*4,PixelFormat.Format32bppPArgb,pixels);
    }
    void ReleaseSurface(){
        if(surface!=null){surface.Dispose();surface=null;}
        if(surfaceDC!=IntPtr.Zero){if(previousImage!=IntPtr.Zero)SelectObject(surfaceDC,previousImage);DeleteDC(surfaceDC);surfaceDC=IntPtr.Zero;previousImage=IntPtr.Zero;}
        if(surfaceImage!=IntPtr.Zero){DeleteObject(surfaceImage);surfaceImage=IntPtr.Zero;}
    }
    bool Present(double opacity){
        // Draw directly into the retained top-down DIB. No full-screen allocation
        // or GetHbitmap copy is needed for each of the 60 frames per second.
        var pos=new Point(Left,Top);var size=new NativeSize(Width,Height);var origin=new Point(0,0);var blend=new Blend{alpha=(byte)Math.Round(255*opacity),format=1};
        return UpdateLayeredWindow(Handle,IntPtr.Zero,ref pos,ref size,surfaceDC,ref origin,0,ref blend,2);
    }
    protected override void Dispose(bool disposing){if(disposing){
        if(frameTimer!=null){frameTimer.Dispose();frameTimer=null;}
        if(preciseTimer){timeEndPeriod(1);preciseTimer=false;}
        if(!String.IsNullOrEmpty(frameProbe))try{File.WriteAllLines(frameProbe,frameTimes.ConvertAll(t=>t.ToString("F3",CultureInfo.InvariantCulture)).ToArray());}catch{}
        ReleaseSurface();face.Dispose();
    }base.Dispose(disposing);}
    [STAThread] static void Main(string[] args){
        try{
            SetProcessDpiAwarenessContext(new IntPtr(-4));Application.EnableVisualStyles();
            if(args.Length==2&&args[0]=="--render"){
                Directory.CreateDirectory(args[1]);using(var form=new StartupFeedback("",Process.GetCurrentProcess().Id)){
                    form.Bounds=new Rectangle(0,0,1280,720);form.Geometry();
                    foreach(var time in new[]{350,1500,4800}){form.convergence=time==4800?2000:-1;form.caption=time==4800?"准备就绪":"正在启动…";using(var b=form.DrawScene(time))b.Save(Path.Combine(args[1],time+".png"));}
                }return;
            }
            int parent;if(args.Length!=2||!Int32.TryParse(args[1],out parent))return;
            Application.Run(new StartupFeedback(args[0],parent));
        }catch{/* Optional feedback must not prevent startup. */}
    }
}
