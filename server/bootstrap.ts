import dotenv from "dotenv";

dotenv.config();

const toBoolean = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

if (toBoolean(process.env.ALLOW_INSECURE_TLS)) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

await import("./index.js");
