// Local Windows application. Does not modify PowerShell or OS security policies.
using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using System.Drawing;

internal static class TokenStore {
    private static readonly string State = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..");
    private static readonly string TokenPath = Path.GetFullPath(Path.Combine(State, "github-token.v2.dpapi"));
    private static bool Valid(string token) {
        return token != null && token.Length >= 30 && token.Length <= 255 && Regex.IsMatch(token, @"\Agithub_pat_[A-Za-z0-9_]+\z");
    }
    [STAThread]
    private static int Main(string[] args) {
        try {
            Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length != 1) return 1;
            if (args[0] == "selftest") {
                byte[] fake = Encoding.UTF8.GetBytes("NON_SECRET_SELF_TEST_" + Guid.NewGuid().ToString());
                byte[] encrypted = ProtectedData.Protect(fake, null, DataProtectionScope.CurrentUser);
                byte[] roundTrip = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
                bool ok = Convert.ToBase64String(fake) == Convert.ToBase64String(roundTrip) && encrypted.Length > fake.Length;
                Array.Clear(fake, 0, fake.Length); Array.Clear(roundTrip, 0, roundTrip.Length);
                Console.WriteLine(ok ? "DPAPI self-test passed (synthetic data only)." : "DPAPI self-test failed.");
                return ok ? 0 : 4;
            }
            if (args[0] == "read") {
                // Refuse direct display on an interactive console.
                if (!Console.IsOutputRedirected) return 3;
                if (!File.Exists(TokenPath)) return 2;
                byte[] decrypted = ProtectedData.Unprotect(File.ReadAllBytes(TokenPath), null, DataProtectionScope.CurrentUser);
                try {
                    string token = Encoding.UTF8.GetString(decrypted);
                    if (!Valid(token)) return 6;
                    Console.Write(token); // Pipe consumed privately by publisher; never logged.
                    return 0;
                } finally { Array.Clear(decrypted, 0, decrypted.Length); }
            }
            if (args[0] != "save") return 1;
            Application.EnableVisualStyles();
            using (Form form = new Form()) {
                form.Text = "胶价雷达 · GitHub 本机授权";
                form.ClientSize = new Size(650, 235);
                form.StartPosition = FormStartPosition.CenterScreen;
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.MaximizeBox = false; form.MinimizeBox = false;
                form.Font = new Font("Microsoft YaHei UI", 10);
                Label info = new Label { Left=22, Top=18, Width=605, Height=66,
                    Text="请粘贴仅授权 Loong-s-Casle 的 Fine-grained token。\n令牌在本机使用 Windows 用户加密保存；不要发给聊天或截图公开。" };
                TextBox input = new TextBox { Left=22, Top=94, Width=605, UseSystemPasswordChar=true, MaxLength=255 };
                Label status = new Label { Left=22, Top=133, Width=605, Height=30, Text="输入会显示为圆点。保存后程序将检查 GitHub 连接。" };
                Button save = new Button { Text="加密保存并继续", Left=350, Top=179, Width=170, Height=36 };
                Button cancel = new Button { Text="取消", Left=534, Top=179, Width=93, Height=36, DialogResult=DialogResult.Cancel };
                form.Controls.AddRange(new Control[] {info,input,status,save,cancel});
                form.AcceptButton=save; form.CancelButton=cancel;
                save.Click += delegate {
                    string token = input.Text.Trim();
                    if (!Valid(token)) { status.Text="格式不正确：请粘贴完整的 github_pat_ 开头的令牌。"; return; }
                    byte[] raw = Encoding.UTF8.GetBytes(token);
                    try {
                        byte[] cipher = ProtectedData.Protect(raw, null, DataProtectionScope.CurrentUser);
                        Directory.CreateDirectory(Path.GetDirectoryName(TokenPath));
                        string temporary = TokenPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
                        File.WriteAllBytes(temporary,cipher);
                        if (File.Exists(TokenPath)) File.Replace(temporary,TokenPath,null);
                        else File.Move(temporary,TokenPath);
                        input.Clear(); form.DialogResult=DialogResult.OK; form.Close();
                    } catch { status.Text="本机加密保存失败，未完成授权。请关闭并联系我排查。"; }
                    finally { Array.Clear(raw,0,raw.Length); }
                };
                return form.ShowDialog() == DialogResult.OK ? 0 : 5;
            }
        } catch (Exception error) {
            if (args.Length == 1 && args[0] == "selftest") Console.Error.WriteLine("Synthetic self-test failed: " + error.GetType().Name + " / 0x" + error.HResult.ToString("X8") + " / " + error.Message);
            else Console.Error.WriteLine("Local authorization failed. No token details were logged.");
            return 4;
        }
    }
}
