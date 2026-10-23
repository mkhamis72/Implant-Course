# analysis.R - survival analysis of an Implant Course Manager research export (outcomes-v1)
#
# How to run
#   1. Unpack the CSV export (.zip) into a folder; this script is one of its files.
#   2. In R, once:  install.packages("survival")   (base R plus survival >= 3.0 only)
#   3. setwd("<that folder>"); source("analysis.R")
#      or in a terminal:  Rscript analysis.R <that folder>
#
# What it prints
#   - Kaplan-Meier implant survival, overall and per group, with 95% CIs (log-log transform, as on
#     the Research page) at 1 year (day 365) and 2 years (day 730), and the full table overall.
#   - A log-rank test (survdiff) per group variable.
#   - The ICOI health-grade distribution (latest_grade), overall and per group.
#   - The loading table, without a test (the comparison is biased).
#   - Cox models, one variable at a time and then combined, stratified by course, adjusted for the
#     placing delegate, with robust standard errors clustered on the patient.
#
# Rules (the same as the Research page)
#   - Not assessed is never "no". An empty risk factor (or an empty technique, bone type or product)
#     is its own group: shown in the tables, left out of every test and model.
#   - Survival means the implant is still in the mouth: the event is "lost or removed". A failed
#     implant still in place survives. Time is follow_up_days from placement; tables show months
#     (days / 30.4375).
#   - Implants whose failure date is unknown (event_time_unknown) are left out of the survival
#     analyses, and their number is printed.
#   - Thin data (fewer than 30 implants at risk, fewer than 10 failures in a test, or a group of
#     fewer than 5 implants) gets a warning. The numbers are always shown.
#   - Kaplan-Meier and log-rank treat implants as independent although patients can have several
#     implants; the Cox models use patient-clustered (robust) standard errors.
#
# Column meanings, units and allowed values: data_dictionary.csv.

suppressPackageStartupMessages(library(survival))
# The Cox models use coxph(..., cluster = ), added in survival 3.0.
if (packageVersion("survival") < "3.0") stop("This script needs survival 3.0 or later: install.packages(\"survival\")")

args <- commandArgs(trailingOnly = TRUE)
folder <- if (length(args) >= 1) args[1] else "."

MONTH_DAYS <- 30.4375
MILESTONE_DAYS <- c("1 year" = 365, "2 years" = 730)
# Loading, the same as the app (src/lib/restorations: LOADING_IMMEDIATE_DAYS, LOADING_EARLY_MONTHS):
# immediate = first restoration (temporary or final) within 7 days of placement, early = within
# 2 calendar months (the same day of the month, or the month's last day), otherwise conventional.
LOADING_IMMEDIATE_DAYS <- 7
LOADING_EARLY_MONTHS <- 2
THIN_AT_RISK <- 30
THIN_EVENTS <- 10
THIN_GROUP <- 5
EPV_MIN <- 10

# Columns this script adds; every other column it uses is in data_dictionary.csv.
DERIVED <- c("months", "group")

# Group variables: exported column = label. smoking, diabetes_status and periodontitis_history come
# from patients.csv; brand, technique and bone_type from implants.csv.
GROUP_VARS <- c(
  brand = "Brand",
  technique = "Technique",
  smoking = "Smoking",
  diabetes_status = "Diabetes",
  periodontitis_history = "Periodontitis history",
  bone_type = "Bone type"
)
COX_VARS <- c("technique", "bone_type", "smoking", "diabetes_status", "periodontitis_history", "brand")
ADJUST <- "strata(course_code) + placing_delegate_code"

NOT_ASSESSED <- "Not assessed"
NO_PRODUCT <- "No product recorded"
DASH <- "\u2014"
NO_FAILURES_NOTE <- "No failures yet, so this can't be estimated"
LOADING_BIAS_NOTE <- "Late-loaded implants had to survive until loading, so this comparison is biased; no test is shown."

# ---- Reading -------------------------------------------------------------------------------------

read_export <- function(name) {
  path <- file.path(folder, paste0(name, ".csv"))
  if (!file.exists(path)) stop("Can't find ", path, ". Run this script in the folder of the unpacked CSV export.")
  df <- read.csv(path, fileEncoding = "UTF-8-BOM", colClasses = "character", na.strings = "", check.names = FALSE)
  # The export puts an apostrophe before text a spreadsheet would read as a formula: take it off.
  for (col in names(df)) df[[col]] <- sub("^'([-=+@\t\r])", "\\1", df[[col]])
  df
}

dict <- read_export("data_dictionary")

# Coded columns become factors with the dictionary's labels, in the dictionary's order. Empty stays NA.
label_coded <- function(df, table) {
  coded <- dict[dict$table == table & dict$kind == "coded" & !is.na(dict$allowed_values), ]
  for (i in seq_len(nrow(coded))) {
    col <- coded$column[i]
    if (!(col %in% names(df))) next
    pairs <- strsplit(coded$allowed_values[i], "; ", fixed = TRUE)[[1]]
    at <- regexpr(" = ", pairs, fixed = TRUE)
    values <- substr(pairs, 1, at - 1)
    labels <- substr(pairs, at + 3, nchar(pairs))
    unknown <- setdiff(unique(na.omit(df[[col]])), values)
    if (length(unknown) > 0) warning(table, ".", col, " has values not in the dictionary: ", paste(unknown, collapse = ", "))
    df[[col]] <- factor(df[[col]], levels = values, labels = labels)
  }
  df
}

implants <- read_export("implants")
patients <- read_export("patients")

implants$follow_up_days <- as.numeric(implants$follow_up_days)
implants$event <- as.logical(implants$event)
implants$event_time_unknown <- as.logical(implants$event_time_unknown)
implants$placed_on <- as.Date(implants$placed_on, format = "%Y-%m-%d")
implants$loaded_on <- as.Date(implants$loaded_on, format = "%Y-%m-%d")

implants <- label_coded(implants, "implants")
patients <- label_coded(patients, "patients")
implants <- merge(implants, patients, by = "patient_code", all.x = TRUE, sort = FALSE)

# ---- Helpers -------------------------------------------------------------------------------------

format_p <- function(p) ifelse(is.na(p), DASH, ifelse(p < 0.001, "p < 0.001", sprintf("p = %.3f", p)))

thin_warning <- function(n, events) {
  sprintf("\u26a0 Not enough data %s interpret with caution (n = %d, %d failure%s)", DASH, n, events, ifelse(events == 1, "", "s"))
}

is_unknown_date <- function(d) d$event_time_unknown %in% TRUE

unknown_date_note <- function(k) {
  if (k > 0) cat(sprintf("%d failure%s with unknown date not included\n", k, ifelse(k == 1, "", "s")))
}

# The implants of a survival analysis: known failure date, time in months.
km_rows <- function(d) {
  km <- d[!is_unknown_date(d) & !is.na(d$follow_up_days) & !is.na(d$event), ]
  km$months <- km$follow_up_days / MONTH_DAYS
  km
}

# A group variable as a factor; the missing value is its own last level (shown, never tested).
group_of <- function(d, var) {
  if (var == "brand") {
    x <- d$brand
    # One brand: split by brand and system instead, like the Research page.
    if (length(unique(na.omit(x))) == 1) x <- ifelse(is.na(x) | is.na(d$system), x, paste(x, d$system, sep = " \u00b7 "))
    x <- factor(x, levels = sort(unique(na.omit(x))))
    missing <- NO_PRODUCT
  } else {
    x <- d[[var]]
    missing <- NOT_ASSESSED
  }
  x <- addNA(x, ifany = FALSE)
  levels(x)[is.na(levels(x))] <- missing
  droplevels(x)
}

# The ICOI grade of each implant's latest assessable visit (labelled from the dictionary); empty = not graded yet.
grade_of <- function(d) {
  g <- addNA(d$latest_grade, ifany = FALSE)
  levels(g)[is.na(levels(g))] <- "Not graded"
  g
}

# The same day of the month `months` later, clamped to the last day of a shorter month.
add_months <- function(date, months) {
  lt <- as.POSIXlt(date)
  total <- (lt$year + 1900) * 12 + lt$mon + months
  following <- total + 1
  first_of_following <- as.Date(sprintf("%04d-%02d-01", following %/% 12, following %% 12 + 1), format = "%Y-%m-%d")
  last_day <- as.integer(format(first_of_following - 1, "%d"))
  as.Date(sprintf("%04d-%02d-%02d", total %/% 12, total %% 12 + 1, pmin(lt$mday, last_day)), format = "%Y-%m-%d")
}

# Loading from loaded_on - placed_on (loaded_on = the earliest restoration, temporary or final).
loading_of <- function(placed, loaded) {
  out <- rep("Not loaded", length(placed))
  has <- !is.na(loaded)
  out[has] <- "Conventional"
  out[has & loaded <= add_months(placed, LOADING_EARLY_MONTHS)] <- "Early"
  out[has & loaded <= placed + LOADING_IMMEDIATE_DAYS] <- "Immediate"
  droplevels(factor(out, levels = c("Immediate", "Early", "Conventional", "Not loaded")))
}

# Kaplan-Meier at day 365 and day 730: estimate, 95% CI and number at risk.
milestones <- function(fit) {
  s <- summary(fit, times = MILESTONE_DAYS / MONTH_DAYS, extend = TRUE)
  groups <- if (is.null(s$strata)) rep("All implants", length(s$time)) else sub("^group=", "", as.character(s$strata))
  followed <- s$n.risk > 0
  no_ci <- s$surv >= 1 | is.na(s$lower) | is.na(s$upper)
  data.frame(
    group = groups,
    at = rep(names(MILESTONE_DAYS), length.out = length(s$time)),
    survival = ifelse(followed, sprintf("%.1f%%", 100 * s$surv), paste(DASH, "(no implant followed this long yet)")),
    ci_95 = ifelse(!followed, "", ifelse(no_ci, paste(DASH, NO_FAILURES_NOTE), sprintf("%.1f-%.1f%%", 100 * s$lower, 100 * s$upper))),
    at_risk = s$n.risk,
    thin = ifelse(followed & s$n.risk < THIN_AT_RISK, "\u26a0 fewer than 30 at risk", ""),
    stringsAsFactors = FALSE
  )
}

# ---- Overall survival ----------------------------------------------------------------------------

cat("Implant Course Manager research export: implant survival\n")
cat("Outcome rules:", paste(unique(na.omit(implants$version)), collapse = ", "), "\n")
cat(nrow(implants), "implants,", length(unique(implants$patient_code)), "patients\n")
cat("Not assessed is never \"no\": empty values are their own group, shown but left out of every test and model.\n")

km <- km_rows(implants)
cat("\n== Overall Kaplan-Meier survival ==\n")
unknown_date_note(sum(is_unknown_date(implants)))
if (nrow(km) == 0) stop("No implants with a known failure date to analyse.")
overall <- survfit(Surv(months, event) ~ 1, data = km, conf.type = "log-log")
print(overall)
print(milestones(overall), row.names = FALSE)
if (nrow(km) < THIN_AT_RISK || sum(km$event) < THIN_EVENTS) cat(thin_warning(nrow(km), sum(km$event)), "\n")
cat("\nFull table (time in months):\n")
print(summary(overall))

cat("\n== ICOI health grade (latest assessable visit), all implants ==\n")
grades <- table(grade_of(implants))
print(cbind(implants = grades, percent = round(100 * grades / max(sum(grades), 1), 1)))

# ---- Group comparisons ---------------------------------------------------------------------------

log_rank <- function(km) {
  tested <- km[!(km$group %in% c(NOT_ASSESSED, NO_PRODUCT)), ]
  tested$group <- droplevels(tested$group)
  events <- sum(tested$event)
  if (nlevels(tested$group) < 2) return(cat("Log-rank test:", DASH, "(needs at least two groups to compare)\n"))
  if (events == 0) return(cat("Log-rank test:", DASH, paste0("(", NO_FAILURES_NOTE, ")"), "\n"))
  lr <- tryCatch(survdiff(Surv(months, event) ~ group, data = tested), error = function(e) {
    cat("Log-rank test:", DASH, "(could not be computed:", conditionMessage(e), ")\n")
    NULL
  })
  if (is.null(lr)) return(invisible(NULL))
  df <- length(lr$n) - 1
  p <- pchisq(lr$chisq, df, lower.tail = FALSE)
  cat(sprintf("Log-rank test on %d implants, %d failure%s: %s (chi-square = %.2f, df = %d)\n",
              nrow(tested), events, ifelse(events == 1, "", "s"), format_p(p), lr$chisq, df))
  if (nrow(tested) < THIN_AT_RISK || events < THIN_EVENTS || min(table(tested$group)) < THIN_GROUP) {
    cat(thin_warning(nrow(tested), events), "\n")
  }
}

compare_groups <- function(title, group, test = TRUE) {
  cat("\n==", title, "==\n")
  d <- implants
  d$group <- group
  counts <- data.frame(
    implants = as.vector(table(d$group)),
    failures = as.vector(tapply(d$event & !is_unknown_date(d), d$group, sum, na.rm = TRUE)),
    failure_date_unknown = as.vector(tapply(is_unknown_date(d), d$group, sum)),
    row.names = levels(d$group)
  )
  print(counts)
  cat("ICOI health grade (latest assessable visit):\n")
  print(table(d$group, grade_of(d), dnn = c(title, "ICOI grade")))
  unknown_date_note(sum(is_unknown_date(d)))
  km <- km_rows(d)
  if (nrow(km) == 0) return(cat("No implants with a known failure date.\n"))
  fit <- survfit(Surv(months, event) ~ group, data = km, conf.type = "log-log")
  print(milestones(fit), row.names = FALSE)
  if (test) {
    missing <- intersect(as.character(unique(km$group)), c(NOT_ASSESSED, NO_PRODUCT))
    if (length(missing) > 0) cat(missing, "is shown but not included in the test.\n")
    log_rank(km)
  }
}

for (var in names(GROUP_VARS)) compare_groups(GROUP_VARS[[var]], group_of(implants, var))

compare_groups("Loading", loading_of(implants$placed_on, implants$loaded_on), test = FALSE)
cat(LOADING_BIAS_NOTE, "\n")

# ---- Cox models ----------------------------------------------------------------------------------
#   coxph(Surv(follow_up_days, event) ~ <vars> + strata(course_code) + placing_delegate_code, cluster = patient_code)
# Rows with a not assessed (empty) value are dropped, never counted as "no". Implants without a course
# form their own stratum. A variable (or the delegate) with one value in the rows used is left out.
# Fewer than 10 events per variable gives a warning; the model is fitted anyway.

fit_cox <- function(vars, title) {
  cat("\n--", title, "--\n")
  d <- km
  d$course_code[is.na(d$course_code)] <- "No course"
  used <- complete.cases(d[, c("follow_up_days", "event", "placing_delegate_code", "patient_code", vars), drop = FALSE])
  dropped <- sum(!used)
  d <- d[used, ]
  keep <- vars[vapply(vars, function(v) length(unique(d[[v]])) >= 2, logical(1))]
  if (length(keep) < length(vars)) cat("Left out (one value in the rows used):", paste(setdiff(vars, keep), collapse = ", "), "\n")
  if (length(keep) == 0) return(cat("Nothing to model. Rows dropped (missing or not assessed):", dropped, "\n"))
  for (v in keep) d[[v]] <- droplevels(factor(d[[v]]))
  adjust <- if (length(unique(d$placing_delegate_code)) >= 2) ADJUST else "strata(course_code)"
  if (adjust != ADJUST) cat("Placing delegate left out: one delegate in the rows used.\n")
  f <- as.formula(paste("Surv(follow_up_days, event) ~", paste(c(keep, adjust), collapse = " + ")))
  fit <- withCallingHandlers(
    tryCatch(coxph(f, data = d, cluster = patient_code), error = function(e) {
      cat("The model could not be fitted:", conditionMessage(e), "\n")
      NULL
    }),
    warning = function(w) {
      cat("Note from coxph:", conditionMessage(w), "\n")
      invokeRestart("muffleWarning")
    }
  )
  if (is.null(fit)) return(invisible(NULL))
  b <- coef(fit)
  if (any(is.na(b))) cat("Not estimable (collinear), left out:", paste(names(b)[is.na(b)], collapse = ", "), "\n")
  params <- sum(!is.na(b))
  cat(sprintf("n used = %d, events = %d, rows dropped (missing or not assessed) = %d\n",
              fit$n, fit$nevent, dropped + nrow(d) - fit$n))
  epv <- fit$nevent / max(params, 1)
  if (epv < EPV_MIN) {
    cat(sprintf("\u26a0 %.1f events per estimated coefficient, delegate terms included (fewer than %d): the estimates are unstable; interpret with caution.\n", epv, EPV_MIN))
  }
  # Hazard ratios of the variables (the delegate terms are adjustment only), with robust 95% CIs.
  cf <- summary(fit)$coefficients
  cf <- cf[!is.na(cf[, "coef"]), , drop = FALSE]
  cf <- cf[Reduce(`|`, lapply(keep, function(v) startsWith(rownames(cf), v))), , drop = FALSE]
  z <- qnorm(0.975)
  print(data.frame(
    hazard_ratio = round(exp(cf[, "coef"]), 2),
    ci_95_lower = round(exp(cf[, "coef"] - z * cf[, "robust se"]), 2),
    ci_95_upper = round(exp(cf[, "coef"] + z * cf[, "robust se"]), 2),
    p_robust = format_p(cf[, "Pr(>|z|)"]),
    row.names = rownames(cf)
  ))
}

cat("\n== Cox models (stratified by course, adjusted for the placing delegate, patient-clustered SEs) ==\n")
for (var in COX_VARS) fit_cox(var, paste("One variable:", var))
fit_cox(COX_VARS, "Combined model")
cat("\nLoading is not modelled: implants had to survive until loading, so a fixed loading group is biased.\n")
