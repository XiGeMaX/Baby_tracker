package app

import (
	"net/http"

	"github.com/flosch/pongo2/v6"
)

func (a *App) dashboardPage(w http.ResponseWriter, r *http.Request) {
	a.renderPage(w, r, "dashboard.html", pongo2.Context{"active_page": "dashboard"})
}

func (a *App) loginPage(w http.ResponseWriter, r *http.Request) {
	a.renderPage(w, r, "login.html", pongo2.Context{"active_page": "login"})
}

func (a *App) registerPage(w http.ResponseWriter, r *http.Request) {
	a.renderPage(w, r, "register.html", pongo2.Context{"active_page": "register"})
}

func (a *App) trendsPage(w http.ResponseWriter, r *http.Request) {
	a.renderPage(w, r, "trends.html", pongo2.Context{"active_page": "trends"})
}

func (a *App) vaccinePage(w http.ResponseWriter, r *http.Request) {
	a.renderPage(w, r, "vaccine.html", pongo2.Context{
		"active_page":      "vaccine",
		"schedule_version": vaccineScheduleVersion,
	})
}

func (a *App) adminPage(w http.ResponseWriter, r *http.Request) {
	state := requestStateFrom(r.Context())
	if state == nil || !isAdmin(state.User) {
		http.Redirect(w, r, a.appURL(r, "/login"), http.StatusFound)
		return
	}
	a.renderPage(w, r, "admin.html", pongo2.Context{"active_page": "admin"})
}

func (a *App) setupPasswordPage(w http.ResponseWriter, r *http.Request) {
	state := requestStateFrom(r.Context())
	if state == nil || !isAdmin(state.User) {
		http.Redirect(w, r, a.appURL(r, "/"), http.StatusFound)
		return
	}
	if !a.adminPasswordSetupRequired(r.Context(), state.User) {
		http.Redirect(w, r, a.appURL(r, "/"), http.StatusFound)
		return
	}
	a.renderPage(w, r, "setup-password.html", pongo2.Context{"active_page": "setup-password"})
}
