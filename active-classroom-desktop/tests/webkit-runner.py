"""Run local fixture in real WebKitGTK, with sandbox/security defaults intact."""
import json
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2

outcome = {"ok": False, "message": "WebKitGTK no entregó resultado"}


def received(_manager, message):
    global outcome
    outcome = json.loads(message.get_js_value().to_string())
    Gtk.main_quit()


def timeout():
    Gtk.main_quit()
    return False


manager = WebKit2.UserContentManager()
manager.register_script_message_handler("result")
manager.connect("script-message-received::result", received)
view = WebKit2.WebView.new_with_user_content_manager(manager)
window = Gtk.Window()
window.add(view)
window.show_all()
GLib.timeout_add_seconds(60, timeout)
view.load_uri(sys.argv[1])
Gtk.main()
print(json.dumps(outcome, ensure_ascii=False))
window.destroy()
sys.exit(0 if outcome["ok"] else 1)
