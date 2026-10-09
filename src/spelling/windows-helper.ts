// The program the Windows spelling engine runs in a hidden PowerShell: Windows' own spell checker (ISpellChecker, the one
// Windows apps use) behind a line protocol on stdin/stdout. Kept here as text because a plugin release holds main.js only.
// Lines in: {"id", "op": "check" | "suggest" | "supported", "tags": [...], "words" | "word"}; lines out: {"id", "unknown" |
// "suggestions" | "supported" | "error"}; the first line out is {"ready": true}. Tried by hand on 2026-10-06 (Windows 11,
// en-GB and ru-RU installed): starts and answers in under a second.
// No `obsidian` import.

export const WINDOWS_HELPER = String.raw`$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class BlueProofSpell {
  [ComImport, Guid("8E018A9D-2415-4677-BF08-794EA61F94BB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFactory {
    IEnumString SupportedLanguages { [return: MarshalAs(UnmanagedType.Interface)] get; }
    [return: MarshalAs(UnmanagedType.Bool)] bool IsSupported([MarshalAs(UnmanagedType.LPWStr)] string tag);
    IChecker CreateSpellChecker([MarshalAs(UnmanagedType.LPWStr)] string tag);
  }
  [ComImport, Guid("E7ED1C71-87F7-4378-A840-C9200DACEE47"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IChecker {
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetLanguageTag();
    IEnumErr Check([MarshalAs(UnmanagedType.LPWStr)] string text);
    IEnumString Suggest([MarshalAs(UnmanagedType.LPWStr)] string word);
  }
  [ComImport, Guid("803E3BD4-2828-4410-8290-418D1D73C762"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IEnumErr { [PreserveSig] int Next([MarshalAs(UnmanagedType.Interface)] out object error); }
  static IFactory factory;
  static readonly Dictionary<string, IChecker> checkers = new Dictionary<string, IChecker>();
  static IFactory Factory() {
    if (factory == null) factory = (IFactory)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("7AB36653-1796-484B-BDFA-E74F1DB7C1DC")));
    return factory;
  }
  // The languages Windows has spelling data for (SupportedLanguages). IsSupported says yes to more: with only en-GB
  // installed it says yes to en-US and checks it with British data (seen 2026-10-08).
  static List<string> installed;
  static List<string> Installed() {
    if (installed == null) {
      installed = new List<string>();
      var e = Factory().SupportedLanguages; var a = new string[1];
      while (true) { a[0] = null; e.Next(1, a, IntPtr.Zero); if (a[0] == null) break; installed.Add(a[0]); }
    }
    return installed;
  }
  // A tag with a region: itself, if installed. A language alone ("en"): its main region, else the first installed of it.
  static string Resolve(string t) {
    var all = Installed();
    foreach (var i in all) if (string.Equals(i, t, StringComparison.OrdinalIgnoreCase)) return i;
    if (t.Contains("-")) return null;
    var main = t.ToLowerInvariant() == "en" ? "en-US" : t.ToLowerInvariant() + "-" + t.ToUpperInvariant();
    foreach (var i in all) if (string.Equals(i, main, StringComparison.OrdinalIgnoreCase)) return i;
    // English without American: British, not the first listed (en-029, Caribbean).
    if (t.ToLowerInvariant() == "en") foreach (var i in all) if (string.Equals(i, "en-GB", StringComparison.OrdinalIgnoreCase)) return i;
    foreach (var i in all) if (i.StartsWith(t + "-", StringComparison.OrdinalIgnoreCase)) return i;
    return null;
  }
  static List<IChecker> For(string[] tags) {
    var list = new List<IChecker>();
    foreach (var t in tags) {
      IChecker c;
      if (!checkers.TryGetValue(t, out c)) { var r = Resolve(t); c = r != null ? Factory().CreateSpellChecker(r) : null; checkers[t] = c; }
      if (c != null) list.Add(c);
    }
    return list;
  }
  public static string[] Supported(string[] tags) {
    var ok = new List<string>();
    foreach (var t in tags) if (Resolve(t) != null) ok.Add(t);
    return ok.ToArray();
  }
  public static string[] All() { return Installed().ToArray(); }
  // The words none of the languages knows.
  public static string[] Unknown(string[] tags, string[] words) {
    var cs = For(tags);
    var bad = new List<string>();
    if (cs.Count == 0) return bad.ToArray();
    foreach (var w in words) {
      bool ok = false;
      foreach (var c in cs) { object e; if (c.Check(w).Next(out e) != 0) { ok = true; break; } }
      if (!ok) bad.Add(w);
    }
    return bad.ToArray();
  }
  public static string[] Suggest(string[] tags, string word) {
    var all = new List<string>();
    foreach (var c in For(tags)) {
      var e = c.Suggest(word);
      var one = new string[1];
      while (e.Next(1, one, IntPtr.Zero) == 0) { if (!all.Contains(one[0])) all.Add(one[0]); if (all.Count >= 8) return all.ToArray(); }
    }
    return all.ToArray();
  }
}
'@
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
	try {
		$q = $line | ConvertFrom-Json
		$tags = [string[]]@($q.tags)
		switch ($q.op) {
			'check' { $a = @{ id = $q.id; unknown = @([BlueProofSpell]::Unknown($tags, [string[]]@($q.words))) } }
			'suggest' { $a = @{ id = $q.id; suggestions = @([BlueProofSpell]::Suggest($tags, [string]$q.word)) } }
			'supported' { $a = @{ id = $q.id; supported = @([BlueProofSpell]::Supported($tags)) } }
			'installed' { $a = @{ id = $q.id; installed = @([BlueProofSpell]::All()) } }
			default { $a = @{ id = $q.id; error = "unknown op $($q.op)" } }
		}
	} catch {
		$a = @{ id = $q.id; error = $_.Exception.Message }
	}
	[Console]::Out.WriteLine(($a | ConvertTo-Json -Compress -Depth 3))
	[Console]::Out.Flush()
}
`;

/**
 * PowerShell's arguments: a short command that reads the program from the first line of input (`programLine`) and runs
 * it. `-Command` is not subject to the execution policy (that is for script files), so nothing is bypassed; until
 * 2026-10-08 it was started with `-ExecutionPolicy Bypass -EncodedCommand <base64>`, a command line that security tools
 * and reviewers flag as what malware does. The program itself stays readable here, in WINDOWS_HELPER.
 */
export const HELPER_ARGS = ['-NoProfile', '-NonInteractive', '-Command', '& ([scriptblock]::Create(([Console]::In.ReadLine() | ConvertFrom-Json)))'];

/** The program as one line of JSON (ASCII only, so the console's input encoding does not matter for it). */
export function programLine(script: string): string {
	const json = JSON.stringify(script);
	let line = '';
	for (let i = 0; i < json.length; i++) {
		const code = json.charCodeAt(i); // UTF-16 units: a character outside the BMP becomes its two escapes, as JSON allows
		line += code < 0x80 ? json[i] : `${String.fromCharCode(0x5c)}u${code.toString(16).padStart(4, '0')}`;
	}
	return `${line}${String.fromCharCode(0x0a)}`;
}
