@echo off
REM Drop CVs into the folder below, then double-click this file.
setlocal
set FOLDER=%~dp0cvs
if not exist "%FOLDER%" mkdir "%FOLDER%"
python "%~dp0cvextract.py" "%FOLDER%" -o "%~dp0cv_contacts.xlsx"
pause
