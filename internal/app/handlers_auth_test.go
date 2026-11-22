package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRegisterEnforcesPasswordLength(t *testing.T) {
	application := newTestApp(t)
	tests := []struct {
		name       string
		username   string
		password   string
		wantStatus int
	}{
		{name: "below minimum", username: "short-password", password: "12345", wantStatus: http.StatusBadRequest},
		{name: "minimum", username: "minimum-password", password: "123456", wantStatus: http.StatusCreated},
		{name: "above maximum", username: "long-password", password: strings.Repeat("x", 129), wantStatus: http.StatusBadRequest},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body, err := json.Marshal(map[string]string{
				"username": test.username,
				"password": test.password,
				"nickname": test.username,
			})
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(string(body)))
			request.Header.Set("Content-Type", "application/json")
			response := performRequest(application, request, nil)
			if response.Code != test.wantStatus {
				t.Fatalf("register status = %d, want %d, body = %s",
					response.Code, test.wantStatus, response.Body.String())
			}
		})
	}
}

func TestSetupAdminPasswordAcceptsSixCharacters(t *testing.T) {
	application := newTestApp(t)
	cookie := loginAsAdmin(t, application)

	short := performRequest(application, httptest.NewRequest(http.MethodPost, "/api/auth/setup-password",
		strings.NewReader(`{"password":"12345","confirm_password":"12345"}`)), cookie)
	if short.Code != http.StatusBadRequest {
		t.Fatalf("short setup password status = %d, want %d", short.Code, http.StatusBadRequest)
	}

	valid := performRequest(application, httptest.NewRequest(http.MethodPost, "/api/auth/setup-password",
		strings.NewReader(`{"password":"123456","confirm_password":"123456"}`)), cookie)
	if valid.Code != http.StatusOK {
		t.Fatalf("valid setup password status = %d, body = %s", valid.Code, valid.Body.String())
	}
	if response := attemptLogin(t, application, "admin", "123456"); response.Code != http.StatusOK {
		t.Fatalf("login with six-character password status = %d, body = %s",
			response.Code, response.Body.String())
	}
}
