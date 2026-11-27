-- Production keeps match_outcomes: the deploy's row-preservation check rejects
-- dropping a table that holds data. This version stays so databases that
-- already recorded V11 still match the latest version.
SELECT 1;
