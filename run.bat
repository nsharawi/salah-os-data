@echo off
rem Salah OS — daily masjid schedule collection. Run by Task Scheduler once a day.
cd /d "%~dp0"
set L=%~dp0last-run.txt
echo === %DATE% %TIME% > "%L%"
node scrape.js >> "%L%" 2>&1
if errorlevel 1 (echo scrape.js failed, see last-run.txt & type "%L%" & pause & exit /b 1)
type "%L%"
git rev-parse --git-dir >nul 2>&1
if errorlevel 1 (echo. & echo Not a git repository yet, so nothing was pushed. & goto done)
git add data >nul 2>&1
git diff --cached --quiet
if errorlevel 1 (
  git commit -q -m "Schedules %DATE%" >nul 2>&1
  git push -q 2>>"%L%"
  if errorlevel 1 (echo. & echo Push failed, see last-run.txt) else (echo. & echo Pushed to GitHub.)
) else (echo. & echo No changes to push.)
:done
if not defined NOPAUSE pause
