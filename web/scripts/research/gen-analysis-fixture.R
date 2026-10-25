# Prints the reference values in src/lib/analysis/tests.fixture.json (base R only).
# Run with: Rscript scripts/research/gen-analysis-fixture.R
g1 <- sleep$extra[sleep$group == 1]
g2 <- sleep$extra[sleep$group == 2]
print(t.test(g2, g1))                          # Welch: diff = mean(g2) - mean(g1)
print(suppressWarnings(wilcox.test(g1, g2)))   # W and p (normal approximation with ties, continuity correction)
print(cor.test(mtcars$wt, mtcars$mpg))
print(suppressWarnings(cor.test(mtcars$wt, mtcars$mpg, method = "spearman")))
print(coef(lm(mpg ~ wt, data = mtcars)))
print(fisher.test(matrix(c(3, 1, 1, 3), nrow = 2)))
print(chisq.test(as.table(rbind(c(762, 327, 468), c(484, 239, 477)))))
print(kruskal.test(list(c(2.9, 3.0, 2.5, 2.6, 3.2), c(3.8, 2.7, 4.0, 2.4), c(2.8, 3.4, 3.7, 2.2, 2.0))))
sp <- sqrt(((length(g1) - 1) * var(g1) + (length(g2) - 1) * var(g2)) / (length(g1) + length(g2) - 2))
d <- (mean(g2) - mean(g1)) / sp
print(d * (1 - 3 / (4 * (length(g1) + length(g2)) - 9)))   # Hedges g
print(c(mean = mean(g1), sd = sd(g1), quantile(g1, c(0, 0.25, 0.5, 0.75, 1))))
