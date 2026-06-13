#!/usr/bin/env python3
"""Scientific calculator command-line application."""

import math
import readline
import sys

VERSION = "1.0"

SAFE_NAMES = {
    # constants
    "pi": math.pi,
    "e": math.e,
    "tau": math.tau,
    "phi": (1 + math.sqrt(5)) / 2,
    "inf": math.inf,
    "nan": math.nan,
    # arithmetic
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    # math functions
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "asin": math.asin,
    "acos": math.acos,
    "atan": math.atan,
    "atan2": math.atan2,
    "sinh": math.sinh,
    "cosh": math.cosh,
    "tanh": math.tanh,
    "asinh": math.asinh,
    "acosh": math.acosh,
    "atanh": math.atanh,
    "sqrt": math.sqrt,
    "log": math.log,
    "log10": math.log10,
    "log2": math.log2,
    "exp": math.exp,
    "pow": pow,
    "floor": math.floor,
    "ceil": math.ceil,
    "trunc": math.trunc,
    "factorial": math.factorial,
    "degrees": math.degrees,
    "radians": math.radians,
    "hypot": math.hypot,
    "comb": math.comb if hasattr(math, "comb") else lambda n, k: 0,
    "perm": math.perm if hasattr(math, "perm") else lambda n, k=None: 0,
    "gamma": math.gamma,
    "lgamma": math.lgamma,
    # statistics helper
    "mean": lambda *values: sum(values) / len(values) if values else float("nan"),
}

COMMANDS = {
    "help": "Show this help message",
    "exit": "Exit the calculator",
    "quit": "Exit the calculator",
    "clear": "Clear the screen",
    "history": "Show last expressions",
    "ans": "Show the last result",
    "m+": "Add last result to memory",
    "m-": "Subtract last result from memory",
    "mr": "Recall memory value",
    "mc": "Clear memory",
}


def print_banner() -> None:
    print("Scientific Calculator")
    print(f"Version {VERSION}")
    print("Type expressions like sin(pi/2), log(100, 10), sqrt(2), or 2**3 + 4")
    print("Type 'help' for commands.")
    print()


def print_help() -> None:
    print("Commands:")
    for name, description in COMMANDS.items():
        print(f"  {name:<8} - {description}")
    print()
    print("Supported functions:")
    print("  sin, cos, tan, asin, acos, atan, sinh, cosh, tanh, sqrt, log, log10, log2, exp")
    print("  factorial, floor, ceil, trunc, degrees, radians, hypot, gamma, lgamma")
    print("Supported constants: pi, e, tau, phi, inf, nan")
    print("Examples:")
    print("  3 + 4 * 2")
    print("  sin(pi/2)")
    print("  log(100, 10)")
    print("  5!  # Use factorial(5)")
    print()


def safe_eval(expression: str, variables: dict) -> object:
    return eval(expression, {"__builtins__": {}}, variables)


def normalize_expression(expression: str) -> str:
    expression = expression.replace("^", "**")
    expression = expression.replace("π", "pi")
    return expression


def create_gui() -> None:
    try:
        import tkinter as tk
    except ImportError:
        print("Tkinter is not available on this system. Run the calculator from the command line instead.")
        sys.exit(1)

    state = {
        "memory": 0.0,
        "last_result": 0.0,
        "history": [],
    }

    def update_status(message: str) -> None:
        status_var.set(message)

    def insert_text(value: str) -> None:
        current = expression_var.get()
        expression_var.set(current + value)

    def clear_expression() -> None:
        expression_var.set("")
        update_status("")

    def evaluate_expression() -> None:
        raw = expression_var.get().strip()
        if not raw:
            return

        expression = normalize_expression(raw)
        expression = expression.replace("ans", str(state["last_result"]))
        expression = expression.replace("mem", str(state["memory"]))

        variables = {**SAFE_NAMES, "ans": state["last_result"], "mem": state["memory"]}

        try:
            result = safe_eval(expression, variables)
            if isinstance(result, float) and result.is_integer():
                result = int(result)
            state["last_result"] = result
            state["history"].append(f"{raw} = {result}")
            expression_var.set(str(result))
            refresh_history()
            update_status("OK")
        except Exception as exc:
            update_status(f"Error: {exc}")

    def delete_last_char() -> None:
        current = expression_var.get()
        expression_var.set(current[:-1])

    def memory_add() -> None:
        state["memory"] += state["last_result"]
        update_status(f"Memory = {state['memory']}")

    def memory_subtract() -> None:
        state["memory"] -= state["last_result"]
        update_status(f"Memory = {state['memory']}")

    def memory_recall() -> None:
        expression_var.set(expression_var.get() + str(state["memory"]))

    def memory_clear() -> None:
        state["memory"] = 0.0
        update_status("Memory cleared")

    root = tk.Tk()
    root.title("Scientific Calculator")
    root.geometry("460x720")
    root.configure(bg="#f5f5f5")
    root.resizable(False, False)

    expression_var = tk.StringVar()
    status_var = tk.StringVar(value="Ready")
    history_vars = [tk.StringVar(value="") for _ in range(3)]

    expression_entry = tk.Entry(
        root,
        textvariable=expression_var,
        font=("Helvetica", 28, "bold"),
        width=20,
        borderwidth=0,
        justify="right",
        bg="#ffffff",
        fg="#1a1a1a",
        insertbackground="#1a1a1a",
        relief="flat",
    )
    expression_entry.place(x=20, y=20, width=420, height=60)
    expression_entry.focus_set()

    display_bg = tk.Frame(root, bg="#efefef", highlightbackground="#d0d0d0", highlightthickness=1)
    display_bg.place(x=20, y=90, width=420, height=100)

    status_label = tk.Label(
        display_bg,
        textvariable=status_var,
        anchor="w",
        font=("Helvetica", 11),
        fg="#333333",
        bg="#efefef",
    )
    status_label.place(x=8, y=8, width=404)

    history_label_fg = "#222222"
    history_item_fg = "#333333"
    history_frame = tk.Frame(root, bg="#f5f5f5")
    history_frame.place(x=20, y=200, width=420, height=75)
    tk.Label(history_frame, text="Last 3 calculations:", fg=history_label_fg, bg="#f5f5f5", font=("Helvetica", 11, "bold")).place(x=8, y=0)
    for i, history_var in enumerate(history_vars):
        tk.Label(
            history_frame,
            textvariable=history_var,
            anchor="w",
            fg=history_item_fg,
            bg="#f5f5f5",
            font=("Helvetica", 10),
        ).place(x=8, y=18 + i * 18)

    def refresh_history() -> None:
        for index in range(3):
            if len(state["history"]) > index:
                history_vars[index].set(state["history"][-1 - index])
            else:
                history_vars[index].set("")

    button_bg = "#e8e8e8"
    button_fg = "#0066cc"
    function_bg = "#d9d9d9"
    accent_bg = "#ff9f0a"
    accent_fg = "#ffffff"

    button_configs = [
        [("MC", memory_clear, function_bg), ("MR", memory_recall, function_bg), ("M+", memory_add, function_bg), ("M-", memory_subtract, function_bg), ("C", clear_expression, accent_bg), ("/", lambda: insert_text("/"), button_bg)],
        [("7", lambda: insert_text("7"), button_bg), ("8", lambda: insert_text("8"), button_bg), ("9", lambda: insert_text("9"), button_bg), ("*", lambda: insert_text("*"), button_bg), ("sin", lambda: insert_text("sin("), function_bg), ("cos", lambda: insert_text("cos("), function_bg)],
        [("4", lambda: insert_text("4"), button_bg), ("5", lambda: insert_text("5"), button_bg), ("6", lambda: insert_text("6"), button_bg), ("-", lambda: insert_text("-"), button_bg), ("tan", lambda: insert_text("tan("), function_bg), ("sqrt", lambda: insert_text("sqrt("), function_bg)],
        [("1", lambda: insert_text("1"), button_bg), ("2", lambda: insert_text("2"), button_bg), ("3", lambda: insert_text("3"), button_bg), ("+", lambda: insert_text("+"), button_bg), ("log", lambda: insert_text("log("), function_bg), ("^", lambda: insert_text("**"), function_bg)],
        [("0", lambda: insert_text("0"), button_bg), (".", lambda: insert_text("."), button_bg), ("(", lambda: insert_text("("), function_bg), (")", lambda: insert_text(")"), function_bg), ("ans", lambda: insert_text("ans"), function_bg), ("mem", lambda: insert_text("mem"), function_bg)],
    ]

    button_start_y = 285
    button_row_height = 65

    for row_idx, row_buttons in enumerate(button_configs):
        y_pos = button_start_y + row_idx * button_row_height
        for col_idx, (text, action, color) in enumerate(row_buttons):
            x_pos = 20 + col_idx * 72
            btn = tk.Button(
                root,
                text=text,
                command=action,
                bg=color,
                fg=button_fg,
                activebackground="#ffb84d" if color == accent_bg else "#d0d0d0",
                activeforeground=button_fg,
                relief="flat",
                font=("Helvetica", 13, "bold"),
                bd=0,
            )
            btn.place(x=x_pos, y=y_pos, width=64, height=56)

    equals_btn = tk.Button(
        root,
        text="=",
        command=evaluate_expression,
        bg=accent_bg,
        fg=button_fg,
        activebackground="#ffb84d",
        activeforeground=button_fg,
        relief="flat",
        font=("Helvetica", 16, "bold"),
        bd=0,
    )
    equals_btn.place(x=20, y=610, width=420, height=60)

    root.bind("<Return>", lambda event: evaluate_expression())
    root.bind("<Escape>", lambda event: clear_expression())
    root.bind("<BackSpace>", lambda event: delete_last_char())
    root.mainloop()


def main() -> None:
    memory = 0.0
    last_result = 0.0
    history = []

    print_banner()

    while True:
        try:
            raw = input("calc> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not raw:
            continue

        command = raw.lower()
        if command in {"exit", "quit"}:
            break
        if command == "help":
            print_help()
            continue
        if command == "clear":
            try:
                import os
                os.system("clear")
            except Exception:
                pass
            continue
        if command == "history":
            if history:
                for idx, item in enumerate(history, start=1):
                    print(f"{idx}: {item}")
            else:
                print("No history yet.")
            continue
        if command == "ans":
            print(last_result)
            continue
        if command == "m+":
            memory += last_result
            print(f"Memory = {memory}")
            continue
        if command == "m-":
            memory -= last_result
            print(f"Memory = {memory}")
            continue
        if command == "mr":
            print(memory)
            continue
        if command == "mc":
            memory = 0.0
            print("Memory cleared")
            continue

        expression = normalize_expression(raw)
        if "ans" in expression:
            expression = expression.replace("ans", str(last_result))
        if "mem" in expression:
            expression = expression.replace("mem", str(memory))

        variables = {**SAFE_NAMES, "ans": last_result, "mem": memory}

        try:
            result = safe_eval(expression, variables)
            if isinstance(result, float) and result.is_integer():
                result = int(result)
            print(result)
            last_result = result
            history.append(raw)
        except Exception as exc:
            print(f"Error: {exc}")

    print("Goodbye.")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].lower() in {"gui", "--gui", "-g"}:
        create_gui()
    else:
        main()
