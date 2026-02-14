Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\dev\deving\agentnative"
WshShell.Run """C:\dev\deving\agentnative\start-agentnative.cmd""", 0, False
