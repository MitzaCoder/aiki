#!/usr/bin/env python3
"""Native binary acceptance + optional warm startup comparison. No inherited server/user configuration."""
import argparse
import json
import os
from pathlib import Path
import queue
import re
import shutil
import signal
import socket
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import urllib.error

# Linux uses the requested setsid -f launcher; macOS has no setsid utility, so Popen creates the same new session.
if len(sys.argv) > 1 and sys.argv[1] == "--exec":
    print(f"PID {os.getpid()}", flush=True)
    os.execv(sys.argv[2], sys.argv[2:])

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--binary", required=True)
parser.add_argument("--smoke", required=True, help="Separate test-only faux executable")
parser.add_argument("--runs", type=int, default=1)
parser.add_argument("--bun", help="Absolute pinned Bun executable, for comparison only")
parser.add_argument("--bun-install", help="Extracted source/web release tree with frozen Bun dependencies installed")
args = parser.parse_args()
if not 1 <= args.runs <= 10:
    parser.error("--runs must be 1..10")
# Keep owner-socket paths below macOS's short sockaddr_un limit, regardless of runner TMPDIR.
root = Path(tempfile.mkdtemp(prefix="aiki-binary-smoke-", dir="/tmp"))
print(f"Smoke root: {root}", flush=True)
path = root / "path"
path.mkdir()
# Host tools remain external. Do not inherit /usr/bin (which may contain Bun on CI).
for tool in ["git", "sh"]:
    executable = shutil.which(tool)
    if not executable:
        raise RuntimeError(f"Smoke requires external {tool}")
    (path / tool).symlink_to(executable)
for name, source in [("aiki", args.binary), ("aiki-smoke", args.smoke)]:
    shutil.copy2(Path(source).resolve(), root / name)
    (root / name).chmod(0o755)
env_command = shutil.which("env")
assert env_command
(root / ".env").write_text("AIKI_STATE_NAMESPACE=binary-dotenv-must-not-load\n")


def environment(name):
    base = root / name
    base.mkdir()
    env = {"USER": "smoke", "HOME": str(base / "home"), "PATH": str(path), "TZ": "UTC",
           "AIKI_DATA_DIR": str(base / "data"), "AIKI_CONFIG_DIR": str(base / "config"),
           "AIKI_AGENT_DIR": str(base / "agent"), "AIKI_CLAUDE_DIR": str(base / "claude"), "AIKI_PORT": "0"}
    for key in ["HOME", "AIKI_CONFIG_DIR", "AIKI_AGENT_DIR", "AIKI_CLAUDE_DIR"]:
        Path(env[key]).mkdir()
    print(f"Isolated paths: {json.dumps(env, sort_keys=True)}", flush=True)
    return env


def clean_command(command, env):
    return [env_command, "-i", *[f"{key}={value}" for key, value in env.items()], *map(str, command)]


def launch(command, env):
    wrapped = [sys.executable, "-I", str(Path(__file__).resolve()), "--exec", *clean_command(command, env)]
    setsid = shutil.which("setsid")
    if sys.platform != "darwin":
        if not setsid:
            raise RuntimeError("Linux smoke requires setsid")
        wrapped = [setsid, "-f", "-w", *wrapped]
    process = subprocess.Popen(wrapped, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, text=True, start_new_session=sys.platform == "darwin")
    lines = queue.Queue()
    def collect():
        for line in process.stdout:
            lines.put(line)
        lines.put(None)
    threading.Thread(target=collect, daemon=True).start()
    first = lines.get(timeout=10)
    if not first or not first.startswith("PID "):
        raise RuntimeError(f"No owned PID: {first}")
    return process, int(first.split()[1]), lines


def stop(process, pid):
    if process.poll() is not None:
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        os.kill(pid, signal.SIGKILL)
        process.wait(timeout=5)
        raise RuntimeError("Server did not stop within 15 seconds")


def get(url, method="GET", headers=None):
    with urllib.request.urlopen(urllib.request.Request(url, method=method, headers=headers or {}), timeout=5) as response:
        return response.status, response.headers, response.read()


def production(command, env, verify):
    started = time.perf_counter()
    process, pid, lines = launch(command, env)
    try:
        deadline = time.monotonic() + 30
        while True:  # Blocking output events, not readiness polling.
            line = lines.get(timeout=max(0.01, deadline - time.monotonic()))
            if line is None:
                raise RuntimeError("Server exited before readiness")
            if verify:
                print(line, end="", flush=True)
            match = re.search(r"Aiki listening on (http://[^ ]+)", line)
            if match:
                elapsed = (time.perf_counter() - started) * 1000
                url = match.group(1)
                break
        if verify:
            config = subprocess.run(clean_command([root / "aiki", "--print-config"], env), cwd=root,
                                    capture_output=True, text=True, timeout=15, check=True)
            assert json.loads(config.stdout)["stateNamespace"] == "aiki", "Implicit dotenv loaded"
            for suffix in ["/", "/pair", "/settings", "/service-worker.js", "/push-worker.js"]:
                status, headers, body = get(url + suffix)
                assert status == 200 and body, suffix
                assert headers["Cache-Control"] == "no-store", suffix
            status, headers, html = get(url + "/")
            assert "text/html" in headers["Content-Type"]
            assert get(url + "/", "HEAD")[2] == b""
            assert get(url + "/backends.json")[2] == b"[]"
            assert json.loads(get(url + "/aiki-local.json")[2]) == {"local": True}
            assert json.loads(get(url + "/auth/status")[2])["mode"] == "required"
            asset = re.search(rb'/_app/immutable/[^"\s)]+\.js', html)
            assert asset, "No immutable JS entry in HTML"
            status, headers, body = get(url + asset.group().decode())
            assert status == 200 and body and "javascript" in headers["Content-Type"]
            assert "immutable" in headers["Cache-Control"]
            for suffix, method, request_headers, expected in [
                    ("/missing.js", "GET", {}, 404), ("/%2ehidden", "GET", {}, 404),
                    ("/", "POST", {}, 405), ("/", "GET", {"Host": "untrusted.example.test"}, 403)]:
                try:
                    get(url + suffix, method, request_headers)
                    raise AssertionError(f"Expected {expected}: {suffix}")
                except urllib.error.HTTPError as error:
                    assert error.code == expected, (suffix, error.code)
            for command_name in ["status", "health-check", "version"]:
                result = subprocess.run(clean_command([root / "aiki", command_name], env), cwd=root,
                                        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15, check=True)
                print(f"{command_name}: {result.stdout.strip()}", flush=True)
                if command_name == "health-check":
                    updates = json.loads(result.stdout)["answer"]["status"]["updates"]
                    assert updates["schemaVersion"] == 1
                    assert updates["enabled"] is False and updates["installedVersion"] is None
                    assert updates["available"] is None, "Standalone smoke must not enable installed-release checks"
            print("PASS: production web, deep links, HEAD/MIME/cache, discovery, required auth, owner status/health, update checks off", flush=True)
        return elapsed
    finally:
        stop(process, pid)


try:
    samples = [production([root / "aiki", "start"], environment(f"binary-{index}"), index == 0)
               for index in range(args.runs)]
    print(f"Binary startup ms: {json.dumps(samples)}; median {statistics.median(samples):.1f}", flush=True)
    if args.bun and args.bun_install:
        (root / ".env").unlink()  # Source Bun intentionally retains its own dotenv behavior.
        tree = Path(args.bun_install).resolve()
        baseline = []
        for index in range(args.runs):
            env = environment(f"bun-{index}")
            base = Path(env["HOME"]).parent
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                port = reservation.getsockname()[1]
            env["AIKI_PORT"] = str(port)
            env["AIKI_INSTALL_DIR"] = str(base)
            (base / "current").symlink_to(tree, target_is_directory=True)
            (base / ".aiki-managed").write_text("aiki-installer-v1\n")
            (base / ".aiki-install.json").write_text(json.dumps({
                "root": str(base), "config": env["AIKI_CONFIG_DIR"], "data": env["AIKI_DATA_DIR"],
                "launcher": str(base / "aiki"), "version": "benchmark"}))
            (Path(env["AIKI_CONFIG_DIR"]) / "server.env").write_text(
                f'AIKI_AGENT_DIR={env["AIKI_AGENT_DIR"]}\nAIKI_CLAUDE_DIR={env["AIKI_CLAUDE_DIR"]}\n')
            baseline.append(production([str(Path(args.bun).resolve()), str(tree / "scripts/aiki.ts"), "start"], env, False))
        print(f"Bun install startup ms: {json.dumps(baseline)}; median {statistics.median(baseline):.1f}", flush=True)
    env = environment("faux")
    process, pid, lines = launch([root / "aiki-smoke"], env)
    try:
        passed = False
        deadline = time.monotonic() + 80
        while True:
            line = lines.get(timeout=max(0.01, deadline - time.monotonic()))
            if line is None:
                break
            print(line, end="", flush=True)
            passed = passed or line.startswith("PASS: coordinator")
        assert process.wait(timeout=5) == 0 and passed, "Faux binary smoke failed"
    finally:
        stop(process, pid)
    print("PASS: binary smoke complete", flush=True)
finally:
    shutil.rmtree(root)
