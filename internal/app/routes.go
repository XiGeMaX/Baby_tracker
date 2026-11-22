package app

import (
	"net/http"
	"strings"
)

func (a *App) registerRoutes() {
	a.mux.Handle("GET /static/", a.staticHandler())

	a.mux.HandleFunc("GET /", a.dashboardPage)
	a.mux.HandleFunc("GET /login", a.loginPage)
	a.mux.HandleFunc("GET /register", a.registerPage)
	a.mux.HandleFunc("GET /history", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/", http.StatusFound)
	})
	a.mux.HandleFunc("GET /trends", a.trendsPage)
	a.mux.HandleFunc("GET /vaccine", a.vaccinePage)
	a.mux.HandleFunc("GET /admin", a.adminPage)
	a.mux.HandleFunc("GET /setup-password", a.setupPasswordPage)

	a.mux.HandleFunc("POST /api/auth/login", a.login)
	a.mux.HandleFunc("POST /api/auth/logout", a.logout)
	a.mux.HandleFunc("POST /api/auth/register", a.register)
	a.mux.HandleFunc("GET /api/auth/me", a.me)
	a.mux.HandleFunc("PUT /api/auth/nickname", a.updateNickname)
	a.mux.HandleFunc("POST /api/auth/setup-password", a.setupAdminPassword)

	a.mux.HandleFunc("GET /api/quick-buttons", a.getQuickButtons)
	a.mux.HandleFunc("POST /api/quick-buttons", a.createQuickButton)
	a.mux.HandleFunc("POST /api/quick-buttons/reorder", a.reorderQuickButtons)
	a.mux.HandleFunc("PUT /api/quick-buttons/{id}", a.updateQuickButton)
	a.mux.HandleFunc("DELETE /api/quick-buttons/{id}", a.deleteQuickButton)
	a.mux.HandleFunc("POST /api/quick-record/{id}", a.quickRecord)

	a.mux.HandleFunc("GET /api/records/dates", a.recordDates)
	a.mux.HandleFunc("GET /api/records/today", a.todaySummary)
	a.mux.HandleFunc("GET /api/records/{id}", a.getRecord)
	a.mux.HandleFunc("GET /api/records", a.getRecords)
	a.mux.HandleFunc("POST /api/records", a.createRecord)
	a.mux.HandleFunc("PUT /api/records/{id}", a.updateRecord)
	a.mux.HandleFunc("DELETE /api/records/{id}", a.deleteRecord)

	a.mux.HandleFunc("GET /api/baby", a.getBaby)
	a.mux.HandleFunc("PUT /api/baby", a.updateBaby)
	a.mux.HandleFunc("GET /api/settings", a.getSettings)
	a.mux.HandleFunc("PUT /api/settings", a.updateSettings)
	a.mux.HandleFunc("GET /api/milk-estimate", a.getMilkEstimate)

	a.mux.HandleFunc("GET /api/users", a.getUsers)
	a.mux.HandleFunc("POST /api/users/{id}/approve", a.approveUser)
	a.mux.HandleFunc("POST /api/users/{id}/reject", a.rejectUser)
	a.mux.HandleFunc("DELETE /api/users/{id}", a.deleteUser)
	a.mux.HandleFunc("PUT /api/users/{id}/password", a.resetUserPassword)
	a.mux.HandleFunc("PUT /api/users/{id}/username", a.updateUsername)

	a.mux.HandleFunc("GET /api/audit-logs", a.getAuditLogs)
	a.mux.HandleFunc("GET /api/export/csv", a.exportCSV)
	a.mux.HandleFunc("GET /api/backup/export", a.backupExport)
	a.mux.HandleFunc("POST /api/backup/restore", a.backupRestore)
	a.mux.HandleFunc("POST /api/data/clear", a.clearData)
	a.mux.HandleFunc("GET /api/stats", a.getStats)

	a.mux.HandleFunc("GET /api/weight-logs", a.getWeightLogs)
	a.mux.HandleFunc("POST /api/weight-logs", a.addWeightLog)
	a.mux.HandleFunc("PUT /api/weight-logs/{id}", a.updateWeightLog)
	a.mux.HandleFunc("DELETE /api/weight-logs/{id}", a.deleteWeightLog)
	a.mux.HandleFunc("GET /api/stats/trends", a.getTrends)

	a.mux.HandleFunc("GET /api/vaccine/schedule", a.getVaccineSchedule)
	a.mux.HandleFunc("POST /api/vaccine/record", a.addVaccineRecord)
	a.mux.HandleFunc("DELETE /api/vaccine/record", a.deleteVaccineRecord)
	a.mux.HandleFunc("PUT /api/vaccine/plan-date", a.updateVaccinePlanDate)
	a.mux.HandleFunc("DELETE /api/vaccine/plan", a.deleteVaccinePlan)
	a.mux.HandleFunc("POST /api/vaccine/custom-plan", a.addVaccineCustomPlan)
	a.mux.HandleFunc("DELETE /api/vaccine/custom-plan", a.deleteVaccineCustomPlan)
	a.mux.HandleFunc("GET /api/vaccine/dates", a.getVaccineDates)
	a.mux.HandleFunc("GET /api/vaccine/day-records", a.getVaccineDayRecords)

	a.mux.HandleFunc("GET /api/health/schedule", a.getHealthSchedule)
	a.mux.HandleFunc("POST /api/health/record", a.addHealthRecord)
	a.mux.HandleFunc("DELETE /api/health/record", a.deleteHealthRecord)
	a.mux.HandleFunc("PUT /api/health/plan-date", a.updateHealthPlanDate)
	a.mux.HandleFunc("GET /api/health/dates", a.getHealthDates)
	a.mux.HandleFunc("GET /api/health/day-records", a.getHealthDayRecords)

	a.mux.HandleFunc("GET /api/countdowns", a.getCountdowns)
	a.mux.HandleFunc("POST /api/countdowns", a.addCountdown)
	a.mux.HandleFunc("PUT /api/countdowns/{id}", a.updateCountdown)
	a.mux.HandleFunc("DELETE /api/countdowns/{id}", a.deleteCountdown)

	a.mux.HandleFunc("GET /api/mcp/config", a.getMCPConfig)
	a.mux.HandleFunc("PUT /api/mcp/config", a.updateMCPConfig)
	a.mux.HandleFunc("GET /api/mcp/api-key", a.getMCPAPIKey)
	a.mux.HandleFunc("POST /api/mcp/api-key", a.generateMCPAPIKey)
	a.mux.Handle("POST "+mcpEndpoint, a.mcp)
	a.mux.Handle("GET "+mcpEndpoint, a.mcp)
	a.mux.Handle("DELETE "+mcpEndpoint, a.mcp)

	a.mux.HandleFunc("GET /api/ha/api-key", a.getHAAPIKey)
	a.mux.HandleFunc("POST /api/ha/api-key", a.generateHAAPIKey)
	a.mux.HandleFunc("GET /api/ha/status", a.haStatus)
	a.mux.HandleFunc("GET /api/ha/feed-today", a.haFeedToday)
	a.mux.HandleFunc("GET /api/ha/last-feed", a.haLastFeed)
	a.mux.HandleFunc("GET /api/ha/excrete-today", a.haExcreteToday)
	a.mux.HandleFunc("GET /api/ha/buttons", a.haButtons)
	a.mux.HandleFunc("GET /api/ha/button/{id}", a.haButtonState)
	a.mux.HandleFunc("POST /api/ha/button/{id}", a.haButtonPress)
	a.mux.HandleFunc("POST /api/ha/button/{id}/press", a.haButtonPress)
}

func pathID(r *http.Request) int64 {
	return intValue(strings.TrimSpace(r.PathValue("id")))
}
