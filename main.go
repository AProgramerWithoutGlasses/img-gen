package main

import (
	"github.com/AProgramerWithoutGlasses/img-gen/internal/studio"
	"log"
)

func main() {
	if err := studio.Run(); err != nil {
		log.Fatal(err)
	}
}
