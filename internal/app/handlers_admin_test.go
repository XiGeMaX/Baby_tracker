package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func attemptLogin(t *testing.T, application *App, username, password string) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(map[string]string{
		"username": username,
		"password": password,
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(string(payload)))
	request.Header.Set("Content-Type", "application/json")
	return performRequest(application, request, nil)
}

func TestUpdateUsernameAllowsAdminAndRejectsDuplicate(t *testing.T) {
	t.Parallel()
	application := newTestApp(t)
	cookie := loginAsAdmin(t, application)
	admin, err := application.queryOne(t.Context(), "SELECT id FROM users WHERE role = 'admin'")
	if err != nil {
		t.Fatal(err)
	}
	adminID := userID(admin)

	request := httptest.NewRequest(http.MethodPut, "/api/users/"+strconv.FormatInt(adminID, 10)+"/username",
		strings.NewReader(`{"username":"caregiver"}`))
	request.Header.Set("Content-Type", "application/json")
	response := performRequest(application, request, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("rename admin status = %d, body = %s", response.Code, response.Body.String())
	}

	if response := attemptLogin(t, application, "caregiver", "admin123"); response.Code != http.StatusOK {
		t.Fatalf("login with renamed admin status = %d, body = %s", response.Code, response.Body.String())
	}

	if _, err := application.db.ExecContext(t.Context(),
		`INSERT INTO users (username, password_hash, nickname, role, status)
		 VALUES ('second-user', ?, '第二用户', 'user', 'approved')`,
		hashPassword("second-user-password")); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest(http.MethodPut, "/api/users/"+strconv.FormatInt(adminID, 10)+"/username",
		strings.NewReader(`{"username":"second-user"}`))
	request.Header.Set("Content-Type", "application/json")
	response = performRequest(application, request, cookie)
	if response.Code != http.StatusConflict {
		t.Fatalf("duplicate rename status = %d, want %d, body = %s", response.Code, http.StatusConflict, response.Body.String())
	}
}

func TestResetPasswordAllowsAdminAccount(t *testing.T) {
	t.Parallel()
	application := newTestApp(t)
	cookie := loginAsAdmin(t, application)
	admin, err := application.queryOne(t.Context(), "SELECT id FROM users WHERE role = 'admin'")
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPut, "/api/users/"+strconv.FormatInt(userID(admin), 10)+"/password",
		strings.NewReader(`{"password":"new-admin-password"}`))
	request.Header.Set("Content-Type", "application/json")
	response := performRequest(application, request, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("reset admin password status = %d, body = %s", response.Code, response.Body.String())
	}

	if response := attemptLogin(t, application, "admin", "admin123"); response.Code != http.StatusUnauthorized {
		t.Fatalf("old password login status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if response := attemptLogin(t, application, "admin", "new-admin-password"); response.Code != http.StatusOK {
		t.Fatalf("new password login status = %d, body = %s", response.Code, response.Body.String())
	}
}
