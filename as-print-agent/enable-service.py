#!/usr/bin/env python3
"""Install a per-user service after explicitly pairing the agent."""
import os
import platform
import plistlib
import subprocess
import sys
from pathlib import Path

NAME = "org.desarrolloproyectos.as-print-agent"
entry = Path(__file__).resolve().with_name("agent.py")
home = Path.home()
state = home / ".local/state/as-print-agent"
if not (state / "identity.json").is_file():
    sys.exit("Vincula las impresoras antes de activar el servicio.")
if platform.system() == "Darwin":
    plist = home / "Library/LaunchAgents" / (NAME + ".plist")
    plist.parent.mkdir(parents=True, exist_ok=True)
    plist.write_bytes(plistlib.dumps({"Label": NAME, "ProgramArguments": [sys.executable, str(entry), "run"],
        "RunAtLoad": True, "KeepAlive": {"SuccessfulExit": False}, "ThrottleInterval": 60, "Umask": 63,
        "StandardErrorPath": str(state / "service-error.log")}))
    service = "gui/" + str(os.getuid())
    subprocess.run(["/bin/launchctl", "bootout", service + "/" + NAME], check=False, capture_output=True)
    subprocess.run(["/bin/launchctl", "bootstrap", service, str(plist)], check=True)
elif platform.system() == "Linux":
    unit = home / ".config/systemd/user/as-print-agent.service"
    unit.parent.mkdir(parents=True, exist_ok=True)
    def escape(word):
        if any(c in word for c in "\r\n"):
            sys.exit("Ruta del agente inválida.")
        return '"' + word.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%").replace("$", "$$") + '"'
    unit.write_text("[Unit]\nDescription=AS Print Agent\nAfter=network-online.target\n"
                    "[Service]\nType=simple\nUMask=0077\nExecStart=" + escape(sys.executable) + " "
                    + escape(str(entry)) + " run\nRestart=on-failure\nRestartSec=60\nRestartPreventExitStatus=2\n"
                    "NoNewPrivileges=true\n[Install]\nWantedBy=default.target\n")
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", "--now", "as-print-agent"], check=True)
else:
    sys.exit("El arranque automático requiere macOS o Linux con systemd de usuario.")
print("Servicio del usuario habilitado.")
