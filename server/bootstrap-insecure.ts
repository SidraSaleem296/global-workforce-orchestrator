process.env.ALLOW_INSECURE_TLS = "true";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

await import("./bootstrap.js");
