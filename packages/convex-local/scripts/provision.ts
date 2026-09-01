import { backendTarget, provisionBackendBinary } from "../src/binary.js";
const target = process.argv[3]?.split("-");
console.log(
  await provisionBackendBinary(
    process.argv[2],
    target ? backendTarget(target[0], target[1]) : undefined,
  ),
);
