/**
 * Stands in for the laptop's fish login shell in the deploy tests: ssh hands the command to fish, which must parse it.
 * deploy/targets.sh wraps every command for a fish target as `bash -c '<quoted>'`, where fish single quotes know
 * exactly two escapes, \\ and \'. This decodes that form the way fish does and runs the result in bash. Other commands
 * (the reachability probe, plain words) read the same in both shells and run as they are.
 */
const command = process.argv[2] ?? "";
const match = /^bash -c '((?:[^'\\]|\\.)*)'$/s.exec(command);
const inner = match ? match[1].replace(/\\([\\'])/g, "$1") : command;
const child = Bun.spawnSync(["bash", "-c", inner], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
process.exit(child.exitCode ?? 1);
