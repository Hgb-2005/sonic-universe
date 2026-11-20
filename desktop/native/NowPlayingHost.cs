using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Windows.Media.Control;

internal sealed class NowPlayingHost
{
    private sealed class SessionKey
    {
        public string Id;
        // Hold the RCW while registered so its COM identity cannot be reused in the next scan.
        public GlobalSystemMediaTransportControlsSession Session;
    }

    private sealed class SessionInfo
    {
        public string sourceId { get; set; }
        public string sourceApp { get; set; }
        public string title { get; set; }
        public string artist { get; set; }
        public string album { get; set; }
        public bool playing { get; set; }
        public double? rate { get; set; }
        public double? position { get; set; }
        public double? duration { get; set; }
        public long? updatedAt { get; set; }
    }

    private readonly string salt = Guid.NewGuid().ToString("N").Substring(0, 8);
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private Dictionary<IntPtr, SessionKey> keys = new Dictionary<IntPtr, SessionKey>();
    private GlobalSystemMediaTransportControlsSessionManager manager;
    private int counter;

    [MTAThread]
    private static int Main()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        return new NowPlayingHost().Run();
    }

    private int Run()
    {
        string command;
        while ((command = Console.ReadLine()) != null)
        {
            if (command != "scan") continue;
            try
            {
                Console.WriteLine(json.Serialize(ScanAsync().GetAwaiter().GetResult()));
            }
            catch (Exception)
            {
                // A later scan can recover if Explorer or the media service restarted.
                manager = null;
                keys.Clear();
                Console.WriteLine("{\"available\":false,\"sessions\":[]}");
            }
        }
        return 0;
    }

    private static IntPtr Identity(GlobalSystemMediaTransportControlsSession session)
    {
        if (session == null) return IntPtr.Zero;
        IntPtr pointer = Marshal.GetIUnknownForObject(session);
        Marshal.Release(pointer);
        return pointer;
    }

    private async Task<object> ScanAsync()
    {
        if (manager == null) manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var currentSession = manager.GetCurrentSession();
        var current = Identity(currentSession);
        var sessions = manager.GetSessions();
        var nextKeys = new Dictionary<IntPtr, SessionKey>();
        var pending = new List<Task<SessionInfo>>();
        string currentId = null;
        foreach (var session in sessions.OrderByDescending(value => Identity(value) == current).Take(24))
        {
            var identity = Identity(session);
            if (nextKeys.ContainsKey(identity)) continue;
            SessionKey key;
            if (!keys.TryGetValue(identity, out key))
                key = new SessionKey { Id = "session-" + salt + "-" + (++counter).ToString(CultureInfo.InvariantCulture) };
            key.Session = session;
            nextKeys.Add(identity, key);
            if (identity == current) currentId = key.Id;
            pending.Add(ReadSessionAsync(key));
        }
        keys = nextKeys;
        var details = await Task.WhenAll(pending);
        if (currentId == null && currentSession != null)
        {
            var candidate = await ReadSessionAsync(new SessionKey { Session = currentSession });
            var sameApp = details.Where(value => value.sourceApp == candidate.sourceApp).ToArray();
            if (sameApp.Length == 1) currentId = sameApp[0].sourceId;
            else
            {
                var sameTrack = sameApp.Where(value => value.title == candidate.title && value.artist == candidate.artist).ToArray();
                if (sameTrack.Length == 1) currentId = sameTrack[0].sourceId;
            }
        }
        return new { available = true, currentId = currentId, sessions = details };
    }

    private static string Trim(string value, int max)
    {
        if (String.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length > max ? trimmed.Substring(0, max) : trimmed;
    }

    private static async Task<SessionInfo> ReadSessionAsync(SessionKey key)
    {
        var session = key.Session;
        var info = new SessionInfo { sourceId = key.Id };
        try { info.sourceApp = Trim(session.SourceAppUserModelId, 512); } catch (Exception) { }
        try
        {
            var playback = session.GetPlaybackInfo();
            info.playing = playback.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
            info.rate = playback.PlaybackRate;
        }
        catch (Exception) { }
        try
        {
            var timeline = session.GetTimelineProperties();
            double duration = (timeline.EndTime - timeline.StartTime).TotalSeconds;
            double position = (timeline.Position - timeline.StartTime).TotalSeconds;
            if (duration > 0.05 && duration <= 172800 && position >= 0 && position <= duration + 1)
            {
                info.duration = duration;
                info.position = Math.Min(position, duration);
                info.updatedAt = timeline.LastUpdatedTime.ToUnixTimeMilliseconds();
            }
        }
        catch (Exception) { }
        try
        {
            var data = await session.TryGetMediaPropertiesAsync();
            info.title = Trim(data.Title, 240);
            info.artist = Trim(data.Artist, 200);
            info.album = Trim(data.AlbumTitle, 200);
        }
        catch (Exception) { }
        return info;
    }
}
