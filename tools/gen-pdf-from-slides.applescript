# Converts an HTML file to PDF using "Safari's" "Save to PDF..." Functionality.
# Reads from the command line the path of the HTML document.
#
# Example: 	osascript gen-pdf-from-slides.applescript ~/Sites/delors.github.io/lab-shell/folien.rst.html
#
# Remark: 		Safari's "Export as PDF" generates PDFs which does not honor 
# 				media settings and we don't want that!
#
# Helpful URLs (for the development):
# 				"Keycodes:"    http://macbiblioblog.blogspot.com/2014/12/key-codes-for-function-and-special-keys.html
# 				"Inspired by:" https://www.macscripter.net/t/scripting-a-full-path-from-standard-save-as-dialog-box/75178/4
#
# Version:		1.0.2
#				Aug. 2024
#				Michael Eichberg
#
# Further Ideas/TODOs:
#				- Ensure that a Generic Printer is selected to get colored PDFs
#				  (Up until then a printer which supports color output has to be the
#				  default printer)
#				- Ensure that "Print Backgrounds" is enabled to get colored Boxes!
#
# Dependencies/Tested with:
# 				(Does not work any longer due to changes to the "Save as" Textfield: Safari 17.3, 17.4, 18.2)
#				Safari 26
on run argv
	
	if length of argv is less than 1 then
		log "[error] Parameter missing!"
		log "GeneratePDFs <Name of the HTML document to convert.>"
		return -1
	end if
	-- split filename into directory and filename parts
	set theFile to item 1 of argv
	
	-- set theFile to "DHBW-W3WI_SE411-Forschungsseminar_Informatik-Adv._Practical_IT_Security/folien.de.rst.html"
	
	set theURL to ("http://localhost:8888/" & theFile)
	log "URL:               " & theURL
	
	set workingDirectory to (do shell script "pwd") & "/"
	log "Working Directory: " & workingDirectory
	
	set filename to (do shell script "basename " & quoted form of theFile)
	log "Filename:          " & filename
	
	set thePathLength to (length of theFile) - (length of filename)
	if thePathLength is 0 then
		set thePath to workingDirectory
	else
		set thePath to workingDirectory & (characters 1 thru thePathLength of theFile as text)
	end if
	log "Target path:       " & thePath
	
	
	-- tell application "Safari" to activate
	tell application "Safari Technology Preview" to activate
	-- tell application "Safari"
	tell application "Safari Technology Preview"
		-- open thePath & filename
		open location theURL
		
		set theScript to "lectureDoc2.prepareForPrinting();"
		delay 1 -- the script sometimes needs some time to execute
		set slidesCount to (do JavaScript theScript in document 1)
		log "Number of slides:  " & slidesCount
		delay 3 -- the script sometimes needs some time to execute
		
		delay slidesCount * 0.15 -- required to wait until all slides are rendered
		
	end tell
	
	-- tell application "System Events" to tell application process "Safari"
	tell application "System Events" to tell application process "Safari Technology Preview"
		set frontmost to true
		
		# window 1
		tell window 1
			
			# PRINT - using keystrokes is faster
			keystroke "p" using {command down}
			
			# check for PRINT sheet
			repeat until exists sheet 1
				delay 0.2
			end repeat
			
			# PRINT sheet
			tell sheet 1
				perform action "AXShowMenu" of menu button 1 of group 2 of splitter group 1 -- pdf menu button
				delay 0.2
				set uiElems to entire contents -- uncomment to facilitate debugging in / development with Script Editor
				-- set saveAsPDFMenu to menu 1 of menu button 1 of group 2 of splitter group 1
				perform action "AXPress" of menu item "Save as PDF…" of menu 1 of menu button 1 of group 2 of splitter group 1 -- save as pdf...
				
				# check for "Save as PDF" sheet
				repeat until exists sheet 1
					delay 0.2
				end repeat
				
				# "Save as PDF" sheet
				tell sheet 1
					set uiElems to entire contents
					# set the filename of the PDF
					(* The following set value ... should work, but it doesn't ... 
						set value of text field "Save As:" of text fields to filename & ".pdf" as text
					*)
					tell (a reference to text field "Save As:" of text fields)
						key code 51 -- press "delete" to remove everything before the ".pdf"
						keystroke filename
						perform action "AXConfirm"
					end tell
					delay 0.2
					
					# We have to set the target folder using the "select folder" dialog
					key code 5 using {command down, shift down} # key code 5 is "g"
					delay 1
					
					key code 51 -- press "delete" (to make the script "safer")
					delay 0.1
					
					keystroke thePath
					delay 0.1
					
					key code 36 -- press "return"
					delay 0.75
					
					tell (a reference to button "Save" of buttons)
						perform action "AXPress"
					end tell
					perform action "AXPress" of button "Save" of buttons
					-- click (every button whose name is "Save")
					delay 0.3
					
					-- The following is probably the most unsave we can do...
					key code 36 -- press "return"
					(* How about: click button "Save" of buttons *)
					delay 0.75
					
					# if the file exists, replace it
					# check if "Replace Existing" sheet appears
					
					if exists sheet 1 then
						log "Replaced     " & filename & ".pdf"
						tell sheet 1 to click button "Replace"
					else
						log "Saved:       " & filename & ".pdf"
					end if
					delay 0.3
					
				end tell -- "Save as PDF" sheet
				
			end tell -- # PRINT sheet
			
		end tell -- window 1
		
	end tell -- application "System Events" > application process "Safari"
	
	-- tell application "Safari"
	tell application "Safari Technology Preview"
		close the current tab of window 1
	end tell
	
end run

