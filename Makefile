VENV   ?= .venv
PY     := $(VENV)/bin/python
APP    := dist/Trimbit Legacy.app

.PHONY: venv run test lint icon app install clean

venv:
	python3 -m venv $(VENV)
	$(PY) -m pip install -U pip
	$(PY) -m pip install -r requirements-dev.txt

run:
	$(PY) -m trimbit_legacy

test:
	$(PY) -m pytest -q

lint:
	$(PY) -m ruff check .

icon:
	$(PY) scripts/make_icon.py

app: clean icon
	$(PY) setup.py py2app

install: app
	rm -rf "/Applications/Trimbit Legacy.app"
	cp -R "$(APP)" /Applications/

clean:
	rm -rf build dist
