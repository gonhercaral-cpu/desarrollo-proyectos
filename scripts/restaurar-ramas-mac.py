#!/usr/bin/env python3
"""Recupera el inventario de Windows sin reemplazar ramas existentes."""
import argparse
import json
import re
import subprocess
from pathlib import Path


def git(root, *args, check=True):
    result = subprocess.run(["git", "-C", str(root), *args], text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result


def restore(root, manifest, worktrees=False, dry_run=False, fetch=True):
    if fetch and not dry_run:
        git(root, "fetch", "origin")
    plans = []
    for branch in manifest["branches"]:
        name = "respaldo-windows/" + branch["name"]
        if not re.fullmatch(r"[0-9a-f]{40}", branch["sha"]):
            raise ValueError("SHA inválido en el inventario")
        plans.append((name, branch["sha"], None))
    for item in manifest["worktrees"]:
        if not item["snapshot_branch"]:
            continue
        ident = item["id"]
        if not re.fullmatch(r"[A-Za-z0-9-]+", ident):
            raise ValueError("Identificador de carpeta inválido")
        target = "refs/remotes/origin/" + item["snapshot_branch"]
        expected = item["code_snapshot_sha"]
        if not re.fullmatch(r"[0-9a-f]{40}", expected):
            raise ValueError("SHA de respaldo inválido")
        if not dry_run:
            git(root, "merge-base", "--is-ancestor", expected, target)
        name = "recuperado-mac/" + ident
        folder = root.parent / (root.name + "-worktrees") / ident if worktrees and ident != "principal" and not item["cleanup_only"] else None
        plans.append((name, target, folder))
    for name, target, folder in plans:
        git(root, "check-ref-format", "--branch", name)
        print(f"{name} <- {target}" + (f" -> {folder}" if folder else ""))
        if dry_run:
            continue
        current = git(root, "rev-parse", "--verify", "refs/heads/" + name, check=False)
        wanted = git(root, "rev-parse", target).stdout.strip()
        if current.returncode == 0:
            if current.stdout.strip() != wanted:
                raise RuntimeError(f"La rama {name} ya existe con otro contenido. Se conserva intacta.")
        else:
            git(root, "branch", name, target)
        if folder:
            if folder.exists():
                folder_top = git(folder, "rev-parse", "--show-toplevel", check=False)
                if folder_top.returncode or Path(folder_top.stdout.strip()).resolve() != folder.resolve():
                    raise RuntimeError(f"La carpeta {folder} ya existe y no es la worktree esperada.")
                actual_branch = git(folder, "symbolic-ref", "--short", "HEAD").stdout.strip()
                if actual_branch != name:
                    raise RuntimeError(f"La carpeta {folder} usa otra rama. Se conserva intacta.")
            else:
                folder.parent.mkdir(parents=True, exist_ok=True)
                git(root, "worktree", "add", str(folder), name)
    return len(plans)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worktrees", action="store_true", help="Reconstruir también las carpetas secundarias con trabajo pendiente")
    parser.add_argument("--dry-run", action="store_true", help="Mostrar el plan sin modificar el repositorio")
    parser.add_argument("--sin-descargar", action="store_true", help="Usar las referencias ya descargadas")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "docs" / "traslado-mac-20261106.json").read_text(encoding="utf-8"))
    count = restore(root, manifest, args.worktrees, args.dry_run, not args.sin_descargar)
    print(f"{'Plan de' if args.dry_run else 'Recuperadas'} {count} referencias. La rama activa no se modifica.")


if __name__ == "__main__":
    main()
