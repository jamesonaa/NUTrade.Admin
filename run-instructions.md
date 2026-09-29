Run and debug NUTrade.Admin (net10.0)

1) Verify SDK/runtime

```sh
dotnet --info
dotnet --list-sdks
```

Confirm a .NET 10 SDK/runtime is listed.

2) Clean build artifacts

Windows (PowerShell):

```powershell
Remove-Item -Recurse -Force .\bin\Debug\net10.0, .\obj\Debug\net10.0 -ErrorAction SilentlyContinue
```

macOS/Linux:

```sh
rm -rf ./bin/Debug/net10.0 ./obj/Debug/net10.0
```

3) Ensure no stray System.Private.CoreLib.dll

```sh
# Windows
if (Test-Path .\bin\Debug\net10.0\System.Private.CoreLib.dll) { Remove-Item .\bin\Debug\net10.0\System.Private.CoreLib.dll }
# macOS/Linux
rm -f ./bin/Debug/net10.0/System.Private.CoreLib.dll
```

4) Run the project with the correct host

From repository root:

```sh
dotnet run --project ./NUTrade.Admin.csproj
```

Or publish + run:

```sh
dotnet publish -c Debug -f net10.0 -o ./publish ./NUTrade.Admin.csproj
dotnet ./publish/NUTrade.Admin.dll
```

5) Visual Studio debugging

- Ensure Visual Studio supports .NET 10.
- In Solution Explorer, select the NUTrade.Admin project, open Properties -> Application and confirm Target Framework = net10.0.
- Use the debug dropdown and choose one of the profiles named "http" or "https" (these have "commandName": "Project"), not "IIS Express" or an external program.
- Start debugging (F5).

6) If the TypeLoadException persists

- Paste the output of `dotnet --info` here.
- Paste the Debug Output window log from Visual Studio.

---

I added these instructions so you can run the correct steps to ensure the app uses the .NET 10 runtime and avoid loading the wrong corelib.