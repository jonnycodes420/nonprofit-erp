// tests/fixtures/paypal-webhook-test-key.js — INT-1.
//
// A THROWAWAY RSA KEYPAIR THAT SIGNS NOTHING REAL. It exists for exactly the
// reason \`whsec_localtest\` exists: a webhook suite that can only produce
// INVALID requests proves that everything is refused, which is not the same as
// proving that a forgery is refused. So the scratch server is booted with this
// public key as PAYPAL_WEBHOOK_TEST_CERT and the suite signs with the private
// half, which lets it send one request that PASSES and several that must not.
//
// It is not a credential. It was generated for this file, it verifies nothing
// PayPal ever signed, and production reads the real certificate from PayPal.
module.exports = {
  PUBLIC_PEM: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjbJLsGgHT8Ipt0X9clSu\np/ePuP6Y6N7lnJB/d3QxNrlNd+OjXfwZS0IyxgVGBtlvMl0vs/EPF2TGpX3j7V7k\nT4YgSSVoKvBZgPImM2wqElALPJz5oW8v70ftA1HTkLoYnXTyU+wkrjqOskFWkzYB\nScWO0kMUu+KakwhqkcHcL7jUSK3HXjIiqLQSVynMPJB0/AZCTOPdJIc6sfYCvnp3\nG2sQYN7zBIMWn3MG2xAjPXkOPqcotV6HOH6E1ZzBn0OTl0QncuM6CjvvpUuL5uzj\nyEnhwHr9CFce8yDW/q+HMZxEKr9mjh/S4pb5StcO2MFs9dTcbBD7UopppJtHPLJH\ntQIDAQAB\n-----END PUBLIC KEY-----\n",
  PRIVATE_PEM: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCNskuwaAdPwim3\nRf1yVK6n94+4/pjo3uWckH93dDE2uU1346Nd/BlLQjLGBUYG2W8yXS+z8Q8XZMal\nfePtXuRPhiBJJWgq8FmA8iYzbCoSUAs8nPmhby/vR+0DUdOQuhiddPJT7CSuOo6y\nQVaTNgFJxY7SQxS74pqTCGqRwdwvuNRIrcdeMiKotBJXKcw8kHT8BkJM490khzqx\n9gK+encbaxBg3vMEgxafcwbbECM9eQ4+pyi1Xoc4foTVnMGfQ5OXRCdy4zoKO++l\nS4vm7OPISeHAev0IVx7zINb+r4cxnEQqv2aOH9LilvlK1w7YwWz11NxsEPtSimmk\nm0c8ske1AgMBAAECggEAEY3zfRciQsIYB3XjFKFDoxkTQ/S8zmrg8PDg7dRmDXTP\nEWmREYF8Q7vfjPNVzd7tvQRY9tbISxpn1tReIsgFCoogIVfCTEGLISO+0lOV8b9b\naQa8kYC0JFWZmjXuu0km6Aj3RajlkXU9PP3Fw0anSbOxQkDfxngoNMuP4l9tTzcM\nV7lsFRPSis5DD6GG/reNPGYJktzEbC7+5usQ/ZTO1Gnd33v5NHX1QEe28Tk5/jLZ\nw4Xx+59rPgO6xNVeMUHPvuLyx9c0tvN+6XswVOqblJT3OM+oIB3togt1WYkrpTlr\nZlLiYvW85kQLYU0mEPi9pXXA1421tn2cybjqxZM+QQKBgQDCsBflMd0Hz4HjKUAw\n+4VwhaiZtCCLJHlWiMTaLlRwoSHCktHTJKJ/g+GMKiNiM8AsxVt1KLubC4NBGdlx\nCkfMoAFWPdaKC155Q1IL/z+yIGfRc2bYdPimguApgzcs723qe0tQWbwK+9y6CqsO\nNNoM1q0whokl1dVIlRS91fQ8QQKBgQC6Uf1EwncvXtONGkxOoucfO5/teikE7Tm9\nKTd3orvj5eZioJT7ORQUeKtp3y6Q7PCyq+cUvxBaCUZQFVXbh9/xqsFVf34JPoJ4\nnTtpP1Lwfjj7eYQjszBhqK47ZCMlGChK6/FVQv37mDg2dWrShBSR7MXvSEXnd/vJ\nd7XAyrs+dQKBgGfs6FSIkZyhwIwqcQG0wj6WmrGx3c1o4vy2dZ6iLKES4pqjFS7I\n15WKKNRRiiHZzjQYBgI8hCj3tFEEI3acLkelAhGvYN6/wuaocRvGXZIQilrcZ4IU\nrsb0BgUi7kkmZl5NAp8Zx691UxZcq4Mh42QHFNxadMulofzk1/WeSIoBAoGBAJgl\nE3fuhHy+Jmn2q5EbHTg37CRzuMM5JAj/ezfKPzueJD8tefqbZXZCA1d01AWsNfDw\nxsX+L1AWesAya+XUUl55XV5/uV+7F7d+TWFoQEX6DHXtiKXOUReuMnh1EO3diCmF\n+Y/yIIwuhNiTkSNOj62JdygqEEsvgv/FLTm9UqFxAoGBALbh4M1LmoI7hZ2MXqiK\nf/uLDPBk/YkTPlLpYEBEUQv3BOrh7+d0uCfY/JsM2bcS+vbHLLMHeMBWbFs6EJKD\nODb9DjAjioTg5MzsABLZnSOGv9qOA4XC3l6PBdI0pwv2P5X7y1NR5L9Bahm2JrFp\nzEx+/cEwxdlCc+8gfR9IwjqG\n-----END PRIVATE KEY-----\n",
  WEBHOOK_ID: "WH-INT1-LOCALTEST",
};
