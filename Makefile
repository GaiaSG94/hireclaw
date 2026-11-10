PY ?= python3
PORT ?= 8137

.PHONY: demo attack test web install clean build-contract test-contract test-sandbox

demo:
	@$(PY) -m boss.demo

attack:
	@$(PY) -m boss.attack

test:
	@$(PY) -m pytest -q

build-contract:
	@cd contract && cargo near build non-reproducible-wasm

test-contract:
	@cd contract && cargo test

test-sandbox:
	@cd contract/integration-tests && NEAR_SANDBOX_BIN_PATH=$${NEAR_SANDBOX_BIN_PATH:-/home/baptiste/.local/near-sandbox/near-sandbox} cargo test --test t01_sandbox

web:
	@$(PY) -m boss.webapp --port $(PORT)

install:
	@$(PY) -m pip install -e .

clean:
	@rm -rf runs __pycache__ boss/__pycache__ tests/__pycache__ .pytest_cache contract/target