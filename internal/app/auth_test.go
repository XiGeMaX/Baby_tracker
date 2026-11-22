package app

import (
	"strings"
	"testing"
)

func TestIsPasswordLengthValid(t *testing.T) {
	tests := []struct {
		name     string
		password string
		want     bool
	}{
		{name: "below minimum", password: "12345", want: false},
		{name: "minimum", password: "123456", want: true},
		{name: "typical", password: "secure-password", want: true},
		{name: "maximum", password: strings.Repeat("x", maxPasswordLength), want: true},
		{name: "above maximum", password: strings.Repeat("x", maxPasswordLength+1), want: false},
		{name: "minimum multibyte runes", password: "密码六个字符", want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := isPasswordLengthValid(test.password); got != test.want {
				t.Fatalf("isPasswordLengthValid(%q) = %v, want %v", test.password, got, test.want)
			}
		})
	}
}
