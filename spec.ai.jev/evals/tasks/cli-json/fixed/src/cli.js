const args = process.argv.slice(2);
if (args.includes("--json")) console.log(JSON.stringify({ name: "mu" }));
else console.log(`name: mu`);
