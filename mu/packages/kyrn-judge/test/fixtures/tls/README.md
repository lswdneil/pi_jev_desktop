# Throwaway TLS fixtures

`ca.pem`, `server.pem` and `server.key` exist only for `test/custom-ca.test.ts`. They are a local CA and a
certificate for `127.0.0.1` / `localhost`, generated once with OpenSSL 3.5:

```bash
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -keyout ca.key -out ca.pem -days 3650 \
  -subj "/CN=mu test CA" -addext "basicConstraints=critical,CA:TRUE"
openssl req -newkey rsa:2048 -sha256 -nodes -keyout server.key -out server.csr -subj "/CN=127.0.0.1" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost" -addext "extendedKeyUsage=serverAuth"
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out server.pem -days 3650 \
  -sha256 -copy_extensions copy
openssl verify -CAfile ca.pem server.pem   # server.pem: OK
```

`ca.key` and `server.csr` were deleted after signing: the CA private key is not needed to run the test, and a
committed CA key would be a signing key with nothing to sign.

The private key is committed because the test needs it to start an HTTPS server. It has no other use: it belongs to
this throwaway CA, it is not trusted anywhere, and it signs nothing but the certificate beside it.
