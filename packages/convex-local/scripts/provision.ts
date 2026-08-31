import { provisionBackendBinary } from "../src/binary.js";

console.log(await provisionBackendBinary(process.argv[2]));
