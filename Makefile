PY ?= python3
PORT ?= 8137

.PHONY: demo attack test web install clean build-contract test-contract test-sandbox \
        testnet-deploy testnet-e2e serve-public public-url video

demo:
	@$(PY) -m boss.demo

attack:
	@$(PY) -m boss.attack

test:
	@$(PY) -m pytest -q

build-contract:
	@cd contract && cargo near build non-reproducible-wasm --no-embed-abi --no-doc

test-contract:
	@cd contract && cargo test

test-sandbox: build-contract
	@cd contract/integration-tests && NEAR_SANDBOX_BIN_PATH=$${NEAR_SANDBOX_BIN_PATH:-/home/baptiste/.local/near-sandbox/near-sandbox} cargo test --test t01_sandbox

web:
	@$(PY) -m boss.webapp --port $(PORT)

testnet-deploy:
	@cd scripts && npm install --no-audit --no-fund --silent && node deploy-testnet.mjs

testnet-e2e:
	@cd scripts && node e2e-testnet.mjs

serve-public:
	@systemctl --user enable --now hireclaw-web.service hireclaw-tunnel.service
	@$(MAKE) --no-print-directory public-url

public-url:
	@bash scripts/public-url.sh

video:
	@/tmp/pwenv/bin/python scripts/record-demo.py --url http://127.0.0.1:8137 --out media/demo.webm
	@ffmpeg -y -v error -i media/demo.webm -c:v libx264 -preset medium -crf 26 \
		-pix_fmt yuv420p -movflags +faststart media/demo.mp4
	@ls -la media/demo.mp4

install:
	@$(PY) -m pip install -e .

clean:
	@rm -rf runs __pycache__ boss/__pycache__ tests/__pycache__ .pytest_cache contract/target