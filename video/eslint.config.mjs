import { config } from "@remotion/eslint-config-flat";

export default [...config, { rules: { complexity: ["error", 15] } }];
