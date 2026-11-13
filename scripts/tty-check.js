console.log('stdin tty:', Boolean(process.stdin.isTTY), 'stdout tty:', Boolean(process.stdout.isTTY));
process.stdout.write('prompt-without-newline: ');
setTimeout(() => { process.stdout.write('\ndone\n'); }, 500);
