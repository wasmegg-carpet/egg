.PHONY: all init build dist fastbuild clean dev serve

all: clean
	$(MAKE) dist

init:
	pnpm install

build:
	pnpm build

dist: build
	../_tools/build.py dist --additional assets --additional static

fastbuild: clean
	pnpm fastbuild
	../_tools/build.py dist --additional assets --additional static

clean:
	@$(RM) -r dist src/lib/catalog.json

dev:
	pnpm dev

serve:
	pnpm serve
